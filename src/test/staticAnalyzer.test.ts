import { expect } from 'chai';
import { StaticAnalyzer } from '../staticAnalyzer';

describe('StaticAnalyzer', () => {
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
