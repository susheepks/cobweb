import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { runTests } from '@vscode/test-electron';

/**
 * WHY THIS EXISTS: a nested `.git` directory can't be committed as a normal
 * file in the parent repo (git treats it as a broken submodule reference,
 * and it silently vanishes on a fresh clone unless properly configured as a
 * real submodule with a remote — which a disposable test fixture doesn't
 * have). Instead, the fixture workspace — including its git history — is
 * built fresh in a temp directory every time this test runs, exactly like
 * the pattern used in src/test/gitAnalyzer.test.ts.
 */
function buildFixtureWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cobweb-fixture-'));
  const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });

  fs.writeFileSync(
    path.join(dir, 'sample.ts'),
    [
      'export function usedExport() {',
      '  return 1;',
      '}',
      '',
      'function trulyDeadFunction() {',
      "  return 'nobody calls me';",
      '}',
      '',
      'console.log(usedExport());',
      '',
    ].join('\n')
  );

  sh('git init -q');
  sh('git config user.email "fixture@example.com"');
  sh('git config user.name "Fixture Author"');
  sh('git add sample.ts');
  sh('git commit -q -m "add sample functions"');

  return dir;
}

async function main() {
  const fixtureDir = buildFixtureWorkspace();
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [fixtureDir, '--disable-extensions'],
      // Passed through so the suite can locate sample.ts without guessing
      // a fixed relative path back to a fixture directory that no longer
      // exists on disk in a fixed location.
      extensionTestsEnv: { STALE_CODE_LENS_FIXTURE_DIR: fixtureDir },
    });
  } catch (err) {
    console.error('Integration test run failed:', err);
    process.exit(1);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

main();
