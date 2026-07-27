import * as vscode from 'vscode';
import { CobwebProvider } from './cobwebProvider';
import { DashboardPanel } from './dashboardPanel';

export function activate(context: vscode.ExtensionContext) {
  const provider = new CobwebProvider(context);

  const selector: vscode.DocumentSelector = [
    // ── TypeScript / JavaScript (AST-based analysis) ──
    { language: 'typescript',      scheme: 'file' },
    { language: 'typescriptreact', scheme: 'file' },
    { language: 'javascript',      scheme: 'file' },
    { language: 'javascriptreact', scheme: 'file' },
    // ── Additional languages (regex-based analysis) ───
    { language: 'python',          scheme: 'file' },
    { language: 'go',              scheme: 'file' },
    { language: 'rust',            scheme: 'file' },
    { language: 'java',            scheme: 'file' },
    { language: 'csharp',          scheme: 'file' },
    { language: 'php',             scheme: 'file' },
    { language: 'ruby',            scheme: 'file' },
    { language: 'c',               scheme: 'file' },
    { language: 'cpp',             scheme: 'file' },
    { language: 'swift',           scheme: 'file' },
    { language: 'kotlin',          scheme: 'file' },
    { language: 'sql',             scheme: 'file' },
    { language: 'vue',             scheme: 'file' },
    { language: 'shellscript',     scheme: 'file' },
    { language: 'dart',            scheme: 'file' },
    { language: 'scala',           scheme: 'file' },
  ];

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, provider),

    vscode.commands.registerCommand('cobweb.refresh', () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand(
      'cobweb.showDetails',
      (uri: vscode.Uri, symbolName: string, history: any, candidate: any) => {
        const lines = [
          `Symbol: ${symbolName}`,
          `File: ${vscode.workspace.asRelativePath(uri)}`,
          `Internal references found: ${candidate.referenceCountInProject}`,
          `Exported: ${candidate.isExported ? 'yes' : 'no'}`,
          history.lastModifiedISO
            ? `Last git change: ${new Date(history.lastModifiedISO).toLocaleDateString()} by ${history.lastAuthor ?? 'unknown'}`
            : 'No git history found for this symbol.',
          '',
          'Note: zero internal references does not guarantee dead code — it may be',
          'called dynamically, used as a public API, or invoked by a framework convention.',
        ];
        vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
      }
    ),

    vscode.commands.registerCommand('cobweb.showDashboard', () => {
      const config = vscode.workspace.getConfiguration('cobweb');
      const ignoreGlobs = config.get<string[]>('ignoreGlobs', []);
      DashboardPanel.show(provider.staticAnalyzer, provider.duplicateAnalyzer, provider.gitAnalyzer, config, ignoreGlobs);
    }),

    vscode.commands.registerCommand(
      'cobweb.copyCleanupPrompt',
      async (uri: vscode.Uri, symbolName: string, history: any, candidate: any) => {
        const relPath = vscode.workspace.asRelativePath(uri);
        const refCount = candidate.referenceCountInProject;
        const isExported = candidate.isExported ? 'yes' : 'no';
        const gitLine = history.lastModifiedISO
          ? `Last touched ${history.daysSinceLastModified} day(s) ago by ${history.lastAuthor ?? 'unknown'} (${new Date(history.lastModifiedISO).toLocaleDateString()})`
          : history.repoUsable
          ? 'No git history found for this function'
          : 'Git history unavailable';

        // Grab the source text for the function from the open document (best-effort)
        let snippetBlock = '';
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const startLine = Math.max(0, candidate.startLine - 1);
          const endLine = Math.min(doc.lineCount - 1, candidate.startLine + 49); // up to 50 lines
          const lines: string[] = [];
          for (let i = startLine; i <= endLine; i++) {
            lines.push(doc.lineAt(i).text);
          }
          snippetBlock = `\n\nFunction source (first ~50 lines from line ${candidate.startLine}):\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
        } catch {
          // Non-fatal — prompt is still useful without the snippet
        }

        const prompt = [
          `# Cobweb Dead-Code Review: \`${symbolName}\``,
          '',
          `I'm reviewing a function flagged by the Cobweb VS Code extension as possibly dead code.`,
          `Please help me decide what to do with it.`,
          '',
          '## Function Details',
          `- **Name:** \`${symbolName}\``,
          `- **File:** \`${relPath}\``,
          `- **Internal callers found:** ${refCount === -1 ? 'unknown (analysis failed)' : refCount}`,
          `- **Exported:** ${isExported}`,
          `- **Git history:** ${gitLine}`,
          '',
          '## Questions for you',
          '1. Based on the source, can you tell if this function is genuinely dead, or might it be called dynamically (e.g. via string dispatch, framework convention, or reflection)?',
          '2. If it IS dead, suggest a one-line summary of what it did so I can write a useful commit message when I delete it.',
          '3. If it is NOT dead, explain why and what I should do instead (add a call-site reference, add a test, etc.).',
          '4. If it is similar to other functions in the codebase, suggest how it could be refactored into a shared utility.',
          snippetBlock,
        ].join('\n');

        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage(`📋 Cleanup prompt for \`${symbolName}\` copied to clipboard.`);
      }
    ),

    // Save always triggers a full cache invalidation + refresh, since git
    // history can only meaningfully change after a commit/save-adjacent event.
    vscode.workspace.onDidSaveTextDocument(() => provider.refresh()),

    // Live typing already gets picked up automatically: VS Code re-requests
    // CodeLenses on document changes, and StaticAnalyzer's version-keyed
    // cache means each keystroke's re-parse is cheap. We deliberately avoid
    // adding a manual debounce/refresh timer here, since that would be the
    // most likely way this extension could make typing itself feel laggy.

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cobweb')) {
        provider.refresh();
      }
    })
  );
}

export function deactivate() {
  // No background timers, file watchers, or open sockets exist in this
  // extension — git subprocesses are short-lived and awaited to completion,
  // and the in-memory LRU caches are garbage-collected once the extension
  // host tears down. Nothing to explicitly dispose beyond what's already
  // registered in context.subscriptions.
}
