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
      isOrphanFile: true, functionsWithCallers: [],
    };
    const smallOrphan: FileOrphanResult = {
      filePath: '/small.ts', total: 2, zeroRef: 2, unknownRef: 0, calledRef: 0,
      isOrphanFile: true, functionsWithCallers: [],
    };
    const notOrphan: FileOrphanResult = {
      filePath: '/active.ts', total: 5, zeroRef: 2, unknownRef: 0, calledRef: 3,
      isOrphanFile: false, functionsWithCallers: ['foo', 'bar', 'baz'],
    };

    const results = analyzer.filterOrphanFiles([smallOrphan, notOrphan, bigOrphan]);
    expect(results).to.have.length(2);
    expect(results[0].filePath).to.equal('/big.ts');   // sorted desc by total
    expect(results[1].filePath).to.equal('/small.ts');
  });

  it('filterOrphanFiles returns empty array when no files are orphans', () => {
    const notOrphan: FileOrphanResult = {
      filePath: '/a.ts', total: 3, zeroRef: 0, unknownRef: 0, calledRef: 3,
      isOrphanFile: false, functionsWithCallers: ['x', 'y', 'z'],
    };
    expect(analyzer.filterOrphanFiles([notOrphan])).to.be.empty;
  });
});
