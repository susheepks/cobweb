import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import { GitAnalyzer } from './gitAnalyzer';
import { StaticAnalyzer } from './staticAnalyzer';
import { RegexAnalyzer } from './regexAnalyzer';

export class CobwebProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private gitAnalyzer = new GitAnalyzer();
  private staticAnalyzer = new StaticAnalyzer();
  private regexAnalyzer = new RegexAnalyzer();

  /** Language IDs handled by the TypeScript/JavaScript AST-based analyzer. */
  private static readonly TS_LANGUAGES = new Set([
    'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
  ]);
  private diagnosticsChannel: vscode.OutputChannel;
  private warnedShallowRepos = new Set<string>();

  constructor(context: vscode.ExtensionContext) {
    this.diagnosticsChannel = vscode.window.createOutputChannel('Cobweb');
    context.subscriptions.push(this.diagnosticsChannel);
  }

  /** Full refresh: clears caches (git + static) and re-requests CodeLenses.
   *  Used by the manual "Refresh Analysis" command — cheap incremental
   *  updates already happen automatically via document-version/mtime keys. */
  refresh(): void {
    this.gitAnalyzer.invalidateCache();
    this.regexAnalyzer.invalidateCache();
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration('cobweb');
    const ignoreGlobs = config.get<string[]>('ignoreGlobs', []);
    const staleAfterDaysRaw = config.get<number>('staleAfterDays', 180);
    const staleAfterDays = Number.isFinite(staleAfterDaysRaw) && staleAfterDaysRaw > 0 ? staleAfterDaysRaw : 180;
    const respectExports = config.get<boolean>('respectExports', true);

    const relPath = vscode.workspace.asRelativePath(document.uri, false);
    if (ignoreGlobs.some((glob) => minimatch(relPath, glob))) {
      return [];
    }

    // Performance safety valve: skip pathologically large files that slipped
    // past ignoreGlobs (e.g. a generated file without a matching pattern).
    if (document.getText().length > 500_000) {
      return [];
    }

    const isAstLanguage = CobwebProvider.TS_LANGUAGES.has(document.languageId);
    let candidates;
    try {
      if (isAstLanguage) {
        candidates = this.staticAnalyzer.findCandidatesForDocument(
          document.uri.fsPath,
          document.getText(),
          document.version
        );
      } else {
        candidates = this.regexAnalyzer.findCandidatesForDocument(
          document.uri.fsPath,
          document.getText(),
          document.languageId,
          document.version
        );
      }
    } catch (err) {
      this.diagnosticsChannel.appendLine(`Parse skipped for ${relPath}: ${(err as Error).message}`);
      return [];
    }

    if (token.isCancellationRequested) return [];

    const zeroRefCandidates = candidates.filter((c) => c.referenceCountInProject === 0);
    if (zeroRefCandidates.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];

    for (const candidate of zeroRefCandidates) {
      if (token.isCancellationRequested) break;

      const history = await this.gitAnalyzer.getSymbolHistory(document.uri.fsPath, candidate.name);

      if (history.isShallowRepo && !this.warnedShallowRepos.has(document.uri.fsPath)) {
        this.warnedShallowRepos.add(document.uri.fsPath);
        this.diagnosticsChannel.appendLine(
          `Shallow git clone detected for ${relPath} — "last modified" dates may be inaccurate. Run 'git fetch --unshallow' for full accuracy.`
        );
      }
      if (!history.repoUsable && this.warnedShallowRepos.size === 0) {
        // Only log this once-ish per session per file to avoid spamming the output channel.
        this.diagnosticsChannel.appendLine(
          `No usable git repository found for ${relPath} — showing static reference count only.`
        );
      }

      const range = new vscode.Range(candidate.startLine - 1, 0, candidate.startLine - 1, 0);

      const isStale =
        history.daysSinceLastModified !== null && history.daysSinceLastModified >= staleAfterDays;

      const refLabel = isAstLanguage ? 'no internal callers' : '0 in-file refs';
      const severityLabel =
        candidate.isExported && respectExports
          ? `📦 Exported, ${refLabel}`
          : '⚠️ Possibly dead code';

      const dateInfo = history.lastModifiedISO
        ? `last touched ${history.daysSinceLastModified}d ago${history.lastAuthor ? ` by ${history.lastAuthor}` : ''}`
        : history.repoUsable
        ? 'no git history found for this symbol'
        : 'git history unavailable';

      const staleTag = isStale ? ' · stale' : '';

      lenses.push(
        new vscode.CodeLens(range, {
          title: `${severityLabel} · ${dateInfo}${staleTag}`,
          command: 'cobweb.showDetails',
          arguments: [document.uri, candidate.name, history, candidate],
        })
      );
    }

    return lenses;
  }
}
