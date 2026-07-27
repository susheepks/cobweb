import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticAnalyzer } from '../staticAnalyzer';
import { DuplicateAnalyzer } from '../duplicateAnalyzer';

/**
 * Phase 3 dashboard tests operate on the StaticAnalyzer + DuplicateAnalyzer
 * data layer (which is what the DashboardPanel reads). We don't test the
 * WebviewPanel itself (that requires the full VS Code extension host) but we
 * DO test the data-preparation logic that the dashboard renders, which is
 * the part most likely to regress.
 */
describe('Dashboard data layer (Phase 3)', () => {
  let workspaceDir: string;
  let staticAnalyzer: StaticAnalyzer;
  let duplicateAnalyzer: DuplicateAnalyzer;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobweb-dashboard-'));
    staticAnalyzer = new StaticAnalyzer();
    duplicateAnalyzer = new DuplicateAnalyzer();
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('getAllCandidatesInSeededProject returns all TS functions across the project after seeding', () => {
    fs.writeFileSync(
      path.join(workspaceDir, 'a.ts'),
      `export function alpha() { return 1; }\n`
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'b.ts'),
      `export function beta() { return 2; }\n`
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'c.ts'),
      `export function gamma() { return 3; }\n`
    );

    staticAnalyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);
    const all = staticAnalyzer.getAllCandidatesInSeededProject();

    const names = all.map(c => c.candidate.name);
    expect(names).to.include('alpha');
    expect(names).to.include('beta');
    expect(names).to.include('gamma');
    expect(all.length).to.be.at.least(3);
  });

  it('zero-reference filtering correctly isolates uncalled functions', () => {
    fs.writeFileSync(
      path.join(workspaceDir, 'util.ts'),
      `
      export function usedFn() { return 42; }
      export function deadFn() { return 99; }
      export function caller() { return usedFn(); }
      `
    );

    staticAnalyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);
    const all = staticAnalyzer.getAllCandidatesInSeededProject();

    const zeroRef = all.filter(
      c => c.candidate.referenceCountInProject === 0 || c.candidate.referenceCountInProject === -1
    );
    const names = zeroRef.map(c => c.candidate.name);

    // deadFn has 0 refs; usedFn is called by caller; caller itself is not called from anything
    expect(names).to.include('deadFn');
    expect(names).not.to.include('usedFn');
  });

  it('ignoreGlobs correctly excludes files from project-wide scan', () => {
    fs.mkdirSync(path.join(workspaceDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'src.ts'),
      `export function srcFn() { return 1; }\n`
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'dist', 'generated.ts'),
      `export function generatedFn() { return 2; }\n`
    );

    // Seed with dist excluded
    staticAnalyzer.seedWorkspaceIfNeeded(workspaceDir, ['**/dist/**'], 2000);
    const all = staticAnalyzer.getAllCandidatesInSeededProject();
    const names = all.map(c => c.candidate.name);

    expect(names).to.include('srcFn');
    expect(names).not.to.include('generatedFn');
  });

  it('duplicate detection results are available immediately after findSimilarFunctions', () => {
    fs.writeFileSync(
      path.join(workspaceDir, 'dup.ts'),
      `
      export function processA(items: any[]) {
        let count = 0;
        for (const item of items) {
          count++;
        }
        return count;
      }

      export function processB(things: any[]) {
        let total = 0;
        for (const thing of things) {
          total++;
        }
        return total;
      }
      `
    );

    staticAnalyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);
    const all = staticAnalyzer.getAllCandidatesInSeededProject();

    expect(duplicateAnalyzer.hasCachedResults()).to.be.false;
    duplicateAnalyzer.findSimilarFunctions(all, 0.15);
    expect(duplicateAnalyzer.hasCachedResults()).to.be.true;

    const normalizedPath = path.join(workspaceDir, 'dup.ts').replace(/\\/g, '/');
    const keyA = `${normalizedPath}::processA`;
    const keyB = `${normalizedPath}::processB`;

    const simsA = duplicateAnalyzer.getSimilarFunctions(keyA);
    const simsB = duplicateAnalyzer.getSimilarFunctions(keyB);

    expect(simsA).to.exist;
    expect(simsA?.some(s => s.similarToName === 'processB')).to.be.true;
    expect(simsB?.some(s => s.similarToName === 'processA')).to.be.true;
  });

  it('invalidateCache clears duplicate results so next call re-computes', () => {
    fs.writeFileSync(
      path.join(workspaceDir, 'x.ts'),
      `export function foo() { return 1; }\n`
    );

    staticAnalyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);
    const all = staticAnalyzer.getAllCandidatesInSeededProject();
    duplicateAnalyzer.findSimilarFunctions(all, 0.15);
    expect(duplicateAnalyzer.hasCachedResults()).to.be.true;

    duplicateAnalyzer.invalidateCache();
    expect(duplicateAnalyzer.hasCachedResults()).to.be.false;
  });
});
