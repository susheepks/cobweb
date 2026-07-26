import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { GitAnalyzer } from '../gitAnalyzer';

function sh(cmd: string, cwd: string) {
  execSync(cmd, { cwd, stdio: 'pipe' });
}

describe('GitAnalyzer (against a real temp git repo)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobweb-test-'));
    sh('git init -q', repoDir);
    sh('git config user.email "test@example.com"', repoDir);
    sh('git config user.name "Test User"', repoDir);
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns history for a committed symbol', async () => {
    const filePath = path.join(repoDir, 'foo.ts');
    fs.writeFileSync(filePath, 'function myFunction() { return 1; }\n');
    sh('git add foo.ts', repoDir);
    sh('git commit -q -m "add myFunction"', repoDir);

    const analyzer = new GitAnalyzer();
    const history = await analyzer.getSymbolHistory(filePath, 'myFunction');

    expect(history.repoUsable).to.equal(true);
    expect(history.fileTrackedByGit).to.equal(true);
    expect(history.commitCountTouchingSymbol).to.be.greaterThan(0);
    expect(history.lastAuthor).to.equal('Test User');
    expect(history.daysSinceLastModified).to.be.a('number');
  });

  it('reports fileTrackedByGit=false for an untracked file', async () => {
    const filePath = path.join(repoDir, 'untracked.ts');
    fs.writeFileSync(filePath, 'function neverCommitted() {}\n');
    // Deliberately not `git add`-ed.

    const analyzer = new GitAnalyzer();
    const history = await analyzer.getSymbolHistory(filePath, 'neverCommitted');

    expect(history.repoUsable).to.equal(true);
    expect(history.fileTrackedByGit).to.equal(false);
  });

  it('reports repoUsable=false outside any git repository', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobweb-nogit-'));
    const filePath = path.join(outsideDir, 'x.ts');
    fs.writeFileSync(filePath, 'function x() {}\n');

    const analyzer = new GitAnalyzer();
    const history = await analyzer.getSymbolHistory(filePath, 'x');

    expect(history.repoUsable).to.equal(false);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('caches results and does not re-run git for an unchanged file', async () => {
    const filePath = path.join(repoDir, 'cached.ts');
    fs.writeFileSync(filePath, 'function cachedFn() {}\n');
    sh('git add cached.ts', repoDir);
    sh('git commit -q -m "add cachedFn"', repoDir);

    const analyzer = new GitAnalyzer();
    const first = await analyzer.getSymbolHistory(filePath, 'cachedFn');
    const second = await analyzer.getSymbolHistory(filePath, 'cachedFn');

    // Same object reference proves the LRU cache path was hit on the second call.
    expect(first).to.equal(second);
  });

  it('resolves the correct repo root for a file in a nested subdirectory', async () => {
    const nestedDir = path.join(repoDir, 'src', 'utils');
    fs.mkdirSync(nestedDir, { recursive: true });
    const filePath = path.join(nestedDir, 'deep.ts');
    fs.writeFileSync(filePath, 'function deepFn() {}\n');
    sh('git add src/utils/deep.ts', repoDir);
    sh('git commit -q -m "add deepFn"', repoDir);

    const analyzer = new GitAnalyzer();
    const history = await analyzer.getSymbolHistory(filePath, 'deepFn');

    expect(history.repoUsable).to.equal(true);
    expect(history.fileTrackedByGit).to.equal(true);
  });
});
