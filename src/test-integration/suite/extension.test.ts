import * as vscode from 'vscode';
import { expect } from 'chai';
import * as path from 'path';

describe('Extension integration (real VS Code extension host)', function () {
  this.timeout(20000);

  let doc: vscode.TextDocument;

  before(async () => {
    const fixtureDir = process.env.STALE_CODE_LENS_FIXTURE_DIR;
    if (!fixtureDir) {
      throw new Error(
        'STALE_CODE_LENS_FIXTURE_DIR not set — this suite must be launched via runTests.ts, not run directly.'
      );
    }
    const fixturePath = path.join(fixtureDir, 'sample.ts');
    doc = await vscode.workspace.openTextDocument(fixturePath);
    await vscode.window.showTextDocument(doc);

    // Give the extension host a moment to finish activation on the
    // TypeScript language ID before requesting CodeLenses.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it('extension activates without throwing', () => {
    const ext = vscode.extensions.getExtension('YOUR_PUBLISHER_ID.cobweb');
    expect(ext).to.not.be.undefined;
    expect(ext?.isActive).to.equal(true);
  });

  it('produces exactly one CodeLens — flagging the dead function, none for the used export', async () => {
    const lenses = (await vscode.commands.executeCommand(
      'vscode.executeCodeLensProvider',
      doc.uri,
      10
    )) as vscode.CodeLens[];

    const titles = lenses.map((l) => l.command?.title ?? '');
    const flaggedDead = titles.some((t) => t.includes('Possibly dead code'));

    expect(flaggedDead, `expected a dead-code lens, got titles: ${JSON.stringify(titles)}`).to.equal(true);
    // usedExport has 1 real call site, so it must not generate a lens at all —
    // only zero-reference candidates should.
    expect(lenses.length).to.equal(1);
  });

  it('the refresh command runs without error', async () => {
    await vscode.commands.executeCommand('cobweb.refresh');
    // No assertion beyond "did not throw" — refresh just invalidates caches
    // and re-fires the CodeLens event.
  });
});
