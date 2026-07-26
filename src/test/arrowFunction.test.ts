import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { StaticAnalyzer } from '../staticAnalyzer';

describe('StaticAnalyzer — arrow function detection (v0.3.1)', () => {
  let analyzer: StaticAnalyzer;
  let tmpDir: string;

  beforeEach(() => {
    analyzer = new StaticAnalyzer();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobweb-arrow-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Helper ─────────────────────────────────────────────────────────────────
  function analyse(code: string, filename = 'test.ts') {
    const filePath = path.join(tmpDir, filename);
    return analyzer.findCandidatesForDocument(filePath, code, 1);
  }

  // ── 1. Classic function declarations (existing behaviour unchanged) ─────────
  it('detects a regular function declaration with 0 refs', () => {
    const candidates = analyse(`function unusedHelper() { return 42; }`);
    const names = candidates.map(c => c.name);
    expect(names).to.include('unusedHelper');
  });

  it('does NOT flag a function declaration that is called', () => {
    const code = `
      function doWork() { return 1; }
      doWork();
    `;
    const candidates = analyse(code);
    const hit = candidates.find(c => c.name === 'doWork');
    expect(hit?.referenceCountInProject).to.be.greaterThan(0);
  });

  // ── 2. Arrow functions (NEW in v0.3.1) ────────────────────────────────────
  it('detects an unused const arrow function', () => {
    const code = `const unusedArrow = () => { return 'hello'; };`;
    const candidates = analyse(code);
    const names = candidates.map(c => c.name);
    expect(names).to.include('unusedArrow');
  });

  it('detects an unused async arrow function', () => {
    const code = `const fetchData = async () => { return await Promise.resolve(1); };`;
    const candidates = analyse(code);
    const names = candidates.map(c => c.name);
    expect(names).to.include('fetchData');
  });

  it('does NOT flag an arrow function that is called', () => {
    const code = `
      const helper = () => 42;
      const result = helper();
    `;
    const candidates = analyse(code);
    const hit = candidates.find(c => c.name === 'helper');
    expect(hit?.referenceCountInProject).to.be.greaterThan(0);
  });

  it('detects an exported arrow function with 0 internal callers', () => {
    const code = `export const formatDate = (d: Date) => d.toISOString();`;
    const candidates = analyse(code);
    const hit = candidates.find(c => c.name === 'formatDate');
    expect(hit).to.not.be.undefined;
    expect(hit?.isExported).to.equal(true);
    expect(hit?.referenceCountInProject).to.equal(0);
  });

  // ── 3. Function expressions ────────────────────────────────────────────────
  it('detects an unused function expression', () => {
    const code = `const legacyFn = function() { return true; };`;
    const candidates = analyse(code);
    const names = candidates.map(c => c.name);
    expect(names).to.include('legacyFn');
  });

  // ── 4. Class property arrows ───────────────────────────────────────────────
  it('detects an unused class property arrow function', () => {
    const code = `
      class MyService {
        unusedMethod = () => { return 'noop'; };
      }
    `;
    const candidates = analyse(code);
    const names = candidates.map(c => c.name);
    expect(names).to.include('unusedMethod');
  });

  it('does NOT flag a class property arrow that is referenced', () => {
    const code = `
      class MyService {
        compute = () => 99;
        run() { return this.compute(); }
      }
    `;
    const candidates = analyse(code);
    const hit = candidates.find(c => c.name === 'compute');
    expect(hit?.referenceCountInProject).to.be.greaterThan(0);
  });

  // ── 5. Lifecycle names skipped ─────────────────────────────────────────────
  it('skips known framework lifecycle arrow functions', () => {
    const code = `
      const useEffect = () => {};
      const handler = async (req: any, res: any) => {};
      const middleware = (req: any, res: any, next: any) => {};
    `;
    const candidates = analyse(code);
    const names = candidates.map(c => c.name);
    expect(names).to.not.include('useEffect');
    expect(names).to.not.include('handler');
    expect(names).to.not.include('middleware');
  });
});
