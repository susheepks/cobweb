import * as vscode from 'vscode';
import { CobwebProvider } from './cobwebProvider';

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
