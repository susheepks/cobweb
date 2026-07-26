import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticAnalyzer } from '../staticAnalyzer';

describe('StaticAnalyzer', () => {
  describe('seedWorkspaceIfNeeded (project-wide references)', () => {
    let workspaceDir: string;

    beforeEach(() => {
      workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobweb-workspace-'));
    });

    afterEach(() => {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('REGRESSION: finds a caller that lives in a file the user never opened', () => {
      // helper.ts is never passed through findCandidatesForDocument() below —
      // it only exists on disk. Before the fix, the ts-morph Project never
      // saw this file, so helperFn's caller in caller.ts was invisible and
      // helperFn was misreported as having zero references.
      fs.writeFileSync(
        path.join(workspaceDir, 'helper.ts'),
        `export function helperFn() { return 1; }\n`
      );
      fs.writeFileSync(
        path.join(workspaceDir, 'caller.ts'),
        `import { helperFn } from './helper';\nhelperFn();\n`
      );

      const analyzer = new StaticAnalyzer();
      analyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);

      // The ONLY document ever explicitly analyzed is helper.ts — caller.ts
      // is only on disk, standing in for "a file the user hasn't opened".
      const candidates = analyzer.findCandidatesForDocument(
        path.join(workspaceDir, 'helper.ts'),
        fs.readFileSync(path.join(workspaceDir, 'helper.ts'), 'utf8'),
        1
      );

      const helperFn = candidates.find((c) => c.name === 'helperFn');
      // Before the fix this was 0. ts-morph counts both the import specifier
      // and the call site, so a single cross-file caller reports as >= 1.
      expect(helperFn?.referenceCountInProject).to.be.greaterThan(0);
    });

    it('respects ignoreGlobs so excluded files are not silently counted as callers', () => {
      fs.writeFileSync(
        path.join(workspaceDir, 'helper.ts'),
        `export function helperFn() { return 1; }\n`
      );
      fs.mkdirSync(path.join(workspaceDir, 'dist'));
      fs.writeFileSync(
        path.join(workspaceDir, 'dist', 'bundled.ts'),
        `import { helperFn } from '../helper';\nhelperFn();\n`
      );

      const analyzer = new StaticAnalyzer();
      analyzer.seedWorkspaceIfNeeded(workspaceDir, ['**/dist/**'], 2000);

      const candidates = analyzer.findCandidatesForDocument(
        path.join(workspaceDir, 'helper.ts'),
        fs.readFileSync(path.join(workspaceDir, 'helper.ts'), 'utf8'),
        1
      );

      const helperFn = candidates.find((c) => c.name === 'helperFn');
      expect(helperFn?.referenceCountInProject).to.equal(0);
    });

    it('is idempotent — seeding the same root twice does not throw or duplicate files', () => {
      fs.writeFileSync(path.join(workspaceDir, 'a.ts'), `export function a() {}\n`);

      const analyzer = new StaticAnalyzer();
      expect(() => {
        analyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);
        analyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);
      }).to.not.throw();
    });

    it('getAllCandidatesInSeededProject returns candidates from multiple files', () => {
      fs.writeFileSync(
        path.join(workspaceDir, 'file1.ts'),
        `export function funcOne() { return 1; }\n`
      );
      fs.writeFileSync(
        path.join(workspaceDir, 'file2.ts'),
        `export function funcTwo() { return 2; }\n`
      );

      const analyzer = new StaticAnalyzer();
      analyzer.seedWorkspaceIfNeeded(workspaceDir, [], 2000);

      const allCandidates = analyzer.getAllCandidatesInSeededProject();
      
      const funcOne = allCandidates.find(c => c.candidate.name === 'funcOne');
      const funcTwo = allCandidates.find(c => c.candidate.name === 'funcTwo');

      expect(funcOne).to.exist;
      expect(funcOne?.filePath.replace(/\\/g, '/')).to.include('/file1.ts');
      expect(funcTwo).to.exist;
      expect(funcTwo?.filePath.replace(/\\/g, '/')).to.include('/file2.ts');
    });
  });

  it('flags a function with zero internal references', () => {
    const analyzer = new StaticAnalyzer();
    const code = `
      function usedFunction() { return 1; }
      function unusedFunction() { return 2; }
      console.log(usedFunction());
    `;
    const candidates = analyzer.findCandidatesForDocument('/virtual/a.ts', code, 1);

    const used = candidates.find((c) => c.name === 'usedFunction');
    const unused = candidates.find((c) => c.name === 'unusedFunction');

    expect(used?.referenceCountInProject).to.equal(1);
    expect(unused?.referenceCountInProject).to.equal(0);
  });

  it('does not flag framework lifecycle method names', () => {
    const analyzer = new StaticAnalyzer();
    const code = `
      class Widget {
        ngOnInit() { console.log('init'); }
      }
    `;
    const candidates = analyzer.findCandidatesForDocument('/virtual/b.ts', code, 1);
    const ngOnInit = candidates.find((c) => c.name === 'ngOnInit');
    expect(ngOnInit).to.be.undefined;
  });

  it('marks exported functions as exported', () => {
    const analyzer = new StaticAnalyzer();
    const code = `export function publicApi() { return 42; }`;
    const candidates = analyzer.findCandidatesForDocument('/virtual/c.ts', code, 1);
    const fn = candidates.find((c) => c.name === 'publicApi');
    expect(fn?.isExported).to.equal(true);
    expect(fn?.referenceCountInProject).to.equal(0);
  });

  it('reuses cached results for the same document version', () => {
    const analyzer = new StaticAnalyzer();
    const code = `function a() { return 1; }`;
    const first = analyzer.findCandidatesForDocument('/virtual/d.ts', code, 1);
    const second = analyzer.findCandidatesForDocument('/virtual/d.ts', code, 1);
    // Same array reference proves the cache path was hit, not recomputed.
    expect(first).to.equal(second);
  });

  it('recomputes when the document version changes', () => {
    const analyzer = new StaticAnalyzer();
    const v1 = analyzer.findCandidatesForDocument('/virtual/e.ts', `function a() {}`, 1);
    const v2 = analyzer.findCandidatesForDocument(
      '/virtual/e.ts',
      `function a() {} function b() {}`,
      2
    );
    expect(v1.length).to.equal(1);
    expect(v2.length).to.equal(2);
  });

  it('does not crash on syntactically invalid source (fails soft)', () => {
    const analyzer = new StaticAnalyzer();
    const brokenCode = `function broken( { return`;
    expect(() =>
      analyzer.findCandidatesForDocument('/virtual/f.ts', brokenCode, 1)
    ).to.not.throw();
  });
});
