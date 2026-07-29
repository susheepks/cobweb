import { expect } from 'chai';
import { OrphanAnalyzer, FileOrphanResult } from '../orphanAnalyzer';
import { SymbolCandidate } from '../staticAnalyzer';

function makeCandidate(
  name: string,
  referenceCountInProject: number,
  isExported = true
): SymbolCandidate {
  return { name, startLine: 1, isExported, referenceCountInProject };
}

describe('OrphanAnalyzer (Phase 5)', () => {
  let analyzer: OrphanAnalyzer;

  beforeEach(() => {
    analyzer = new OrphanAnalyzer();
  });

  // ── isOrphanFile = true cases ────────────────────────────────────────────

  it('marks a file as orphan when all exported functions have 0 refs', () => {
    const candidates = [
      makeCandidate('alpha', 0, true),
      makeCandidate('beta', 0, true),
    ];
    const result = analyzer.analyzeFile(candidates, '/src/utils.ts');
    expect(result.isOrphanFile).to.be.true;
    expect(result.zeroRef).to.equal(2);
    expect(result.calledRef).to.equal(0);
    expect(result.functionsWithCallers).to.be.empty;
  });

  it('marks a file as orphan when mix of 0 and -1 ref functions (no known callers)', () => {
    const candidates = [
      makeCandidate('alpha', 0, true),
      makeCandidate('beta', -1, true),   // unknown — not a confirmed caller
    ];
    const result = analyzer.analyzeFile(candidates, '/src/mystery.ts');
    expect(result.isOrphanFile).to.be.true;
    expect(result.zeroRef).to.equal(1);
    expect(result.unknownRef).to.equal(1);
    expect(result.calledRef).to.equal(0);
  });

  // ── isOrphanFile = false cases ───────────────────────────────────────────

  it('does NOT mark a file as orphan when at least one function has callers', () => {
    const candidates = [
      makeCandidate('alpha', 0, true),
      makeCandidate('beta', 3, true),    // beta is called 3 times
    ];
    const result = analyzer.analyzeFile(candidates, '/src/mixed.ts');
    expect(result.isOrphanFile).to.be.false;
    expect(result.calledRef).to.equal(1);
    expect(result.functionsWithCallers).to.include('beta');
  });

  it('does NOT mark a file as orphan when it has NO exported functions', () => {
    // A file with only private functions can't be an "orphan" in the module sense
    const candidates = [
      makeCandidate('alpha', 0, false),  // not exported
      makeCandidate('beta', 0, false),   // not exported
    ];
    const result = analyzer.analyzeFile(candidates, '/src/internal.ts');
    expect(result.isOrphanFile).to.be.false;
  });

  it('does NOT mark an empty file as orphan', () => {
    const result = analyzer.analyzeFile([], '/src/empty.ts');
    expect(result.isOrphanFile).to.be.false;
    expect(result.total).to.equal(0);
  });

  it('isOrphanFile is false for a file with zero candidates — actual boolean: total>0 && hasExported && calledRef===0 && !isEntryPoint', () => {
    // Simulates: export const CONFIG = { foo: 1 }  (no functions — staticAnalyzer produces 0 candidates)
    // total=0 → first clause fails → isOrphanFile=false regardless of everything else
    const result = analyzer.analyzeFile([], '/src/config.ts');
    expect(result.total).to.equal(0);
    expect(result.isOrphanFile).to.be.false;
    // The file is not flagged — NOT because it is safe, but because Cobweb
    // only tracks function/method declarations.  A const-only module that
    // nobody imports is invisible to orphan detection.
  });

  it('isOrphanFile is false for a pure side-effect file (e.g. import "./polyfills")', () => {
    // A side-effect-only file has no exported functions — zero candidates again
    const result = analyzer.analyzeFile([], '/src/polyfills.ts');
    expect(result.total).to.equal(0);
    expect(result.isOrphanFile).to.be.false;
  });

  // ── Stats accuracy ───────────────────────────────────────────────────────

  it('correctly counts zeroRef, unknownRef, and calledRef', () => {
    const candidates = [
      makeCandidate('a', 0),
      makeCandidate('b', 0),
      makeCandidate('c', -1),
      makeCandidate('d', 5),
      makeCandidate('e', 2),
    ];
    const result = analyzer.analyzeFile(candidates, '/src/stats.ts');
    expect(result.total).to.equal(5);
    expect(result.zeroRef).to.equal(2);
    expect(result.unknownRef).to.equal(1);
    expect(result.calledRef).to.equal(2);
    expect(result.functionsWithCallers).to.deep.equal(['d', 'e']);
  });

  it('records the correct filePath', () => {
    const result = analyzer.analyzeFile([makeCandidate('x', 0)], '/custom/path/file.ts');
    expect(result.filePath).to.equal('/custom/path/file.ts');
  });

  // ── filterOrphanFiles ────────────────────────────────────────────────────

  it('filterOrphanFiles returns only orphan files, sorted by total desc', () => {
    const bigOrphan: FileOrphanResult = {
      filePath: '/big.ts', total: 10, zeroRef: 10, unknownRef: 0, calledRef: 0,
      isOrphanFile: true, isEntryPointFile: false, functionsWithCallers: [],
    };
    const smallOrphan: FileOrphanResult = {
      filePath: '/small.ts', total: 2, zeroRef: 2, unknownRef: 0, calledRef: 0,
      isOrphanFile: true, isEntryPointFile: false, functionsWithCallers: [],
    };
    const notOrphan: FileOrphanResult = {
      filePath: '/active.ts', total: 5, zeroRef: 2, unknownRef: 0, calledRef: 3,
      isOrphanFile: false, isEntryPointFile: false, functionsWithCallers: ['foo', 'bar', 'baz'],
    };

    const results = analyzer.filterOrphanFiles([smallOrphan, notOrphan, bigOrphan]);
    expect(results).to.have.length(2);
    expect(results[0].filePath).to.equal('/big.ts');   // sorted desc by total
    expect(results[1].filePath).to.equal('/small.ts');
  });

  it('filterOrphanFiles returns empty array when no files are orphans', () => {
    const notOrphan: FileOrphanResult = {
      filePath: '/a.ts', total: 3, zeroRef: 0, unknownRef: 0, calledRef: 3,
      isOrphanFile: false, isEntryPointFile: false, functionsWithCallers: ['x', 'y', 'z'],
    };
    expect(analyzer.filterOrphanFiles([notOrphan])).to.be.empty;
  });

  // ── Entry-point exclusion (Phase 5 bugfix) ───────────────────────────────

  it('does NOT flag extension.ts as an orphan even when all exports have 0 refs', () => {
    const candidates = [
      makeCandidate('activate', 0, true),
      makeCandidate('deactivate', 0, true),
    ];
    const result = analyzer.analyzeFile(
      candidates,
      '/workspace/src/extension.ts'
      // uses default entryPointGlobs which includes **/extension.ts
    );
    expect(result.isOrphanFile).to.be.false;
    expect(result.isEntryPointFile).to.be.true;
  });

  it('does NOT flag index.ts as an orphan (default entry-point glob)', () => {
    const candidates = [makeCandidate('main', 0, true)];
    const result = analyzer.analyzeFile(candidates, '/project/src/index.ts');
    expect(result.isOrphanFile).to.be.false;
    expect(result.isEntryPointFile).to.be.true;
  });

  it('DOES flag a regular util file with the same zero-ref pattern as an orphan', () => {
    const candidates = [
      makeCandidate('activate', 0, true), // same name as extension.ts export, but different file
      makeCandidate('deactivate', 0, true),
    ];
    // /src/legacy.ts does NOT match any entry-point glob
    const result = analyzer.analyzeFile(candidates, '/src/legacy.ts');
    expect(result.isOrphanFile).to.be.true;
    expect(result.isEntryPointFile).to.be.false;
  });

  it('respects a custom entryPointGlobs list passed directly to analyzeFile', () => {
    const candidates = [makeCandidate('bootstrap', 0, true)];
    // By default **/bootstrap.ts is NOT an entry point
    const withDefault = analyzer.analyzeFile(candidates, '/src/bootstrap.ts');
    expect(withDefault.isOrphanFile).to.be.true;

    // With a custom glob that matches bootstrap.ts, it must be excluded
    const withCustom = analyzer.analyzeFile(
      candidates,
      '/src/bootstrap.ts',
      ['**/bootstrap.ts']
    );
    expect(withCustom.isOrphanFile).to.be.false;
    expect(withCustom.isEntryPointFile).to.be.true;
  });

  it('isEntryPointFile is false for a normal utility file', () => {
    const candidates = [makeCandidate('helper', 0, true)];
    const result = analyzer.analyzeFile(candidates, '/src/utils/helpers.ts');
    expect(result.isEntryPointFile).to.be.false;
  });
});

// ── Barrel / re-export chain integration test ───────────────────────────────
// Uses a real ts-morph Project (via StaticAnalyzer) to verify that
// findReferencesAsNodes() correctly follows re-export chains.
//
// Setup:
//   fileA.ts  — exports function foo() (the candidate under test)
//   index.ts  — re-exports foo via  `export { foo } from './fileA'`
//   consumer.ts — imports foo from './index' (the barrel) and calls it
//
// Expectation: foo's referenceCountInProject > 0, so the OrphanAnalyzer
// does NOT flag fileA.ts as a whole-file orphan.
//
// If this test FAILS it means ts-morph does not trace through re-exports
// and the "barrel" limitation should be added to the documentation.

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { StaticAnalyzer } from '../staticAnalyzer';

describe('OrphanAnalyzer — barrel re-export chain (integration)', () => {
  let tmpDir: string;
  let fileAPath: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobweb-barrel-'));

    fileAPath = path.join(tmpDir, 'fileA.ts');
    const indexPath = path.join(tmpDir, 'index.ts');
    const consumerPath = path.join(tmpDir, 'consumer.ts');

    fs.writeFileSync(fileAPath, [
      '// fileA.ts — foo is only reachable through the barrel index',
      'export function foo() { return 42; }',
    ].join('\n'), 'utf8');

    fs.writeFileSync(indexPath, [
      '// index.ts — barrel re-export',
      "export { foo } from './fileA';",
    ].join('\n'), 'utf8');

    fs.writeFileSync(consumerPath, [
      '// consumer.ts — imports foo through the barrel, not directly from fileA',
      "import { foo } from './index';",
      'export function runFoo() { return foo(); }',
    ].join('\n'), 'utf8');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('foo in fileA.ts has refs > 0 when called via a barrel re-export', () => {
    const staticAnalyzer = new StaticAnalyzer();
    staticAnalyzer.seedWorkspaceIfNeeded(tmpDir, [], 2000);

    const docText = fs.readFileSync(fileAPath, 'utf8');
    const candidates = staticAnalyzer.findCandidatesForDocument(fileAPath, docText, 1);

    const fooCand = candidates.find(c => c.name === 'foo');
    // This assertion documents the ACTUAL behaviour of ts-morph re-export resolution.
    // If ts-morph DOES follow the chain: refs > 0, isOrphanFile stays false ✅
    // If ts-morph does NOT:             refs = 0, isOrphanFile would be true  ❌ (a false positive)
    expect(fooCand, 'foo should be detected as a candidate').to.exist;
    expect(fooCand!.referenceCountInProject).to.be.greaterThan(0,
      'ts-morph should count usages that flow through a barrel re-export; ' +
      'if this fails, add a "barrel re-exports" entry to the README limitations'
    );

    // Also verify the OrphanAnalyzer agrees — fileA.ts is NOT a whole-file orphan
    const orphanAnalyzer = new OrphanAnalyzer();
    const result = orphanAnalyzer.analyzeFile(candidates, fileAPath);
    expect(result.isOrphanFile).to.be.false;
  });
});
