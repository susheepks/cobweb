import * as vscode from 'vscode';
import { StaticAnalyzer } from './staticAnalyzer';
import { DuplicateAnalyzer, SimilarityResult } from './duplicateAnalyzer';
import { GitAnalyzer, GitSymbolHistory } from './gitAnalyzer';

interface DashboardRow {
  name: string;
  filePath: string;
  relPath: string;
  startLine: number;
  referenceCountInProject: number;
  isExported: boolean;
  history: GitSymbolHistory;
  similarTo: SimilarityResult[];
}

export class DashboardPanel {
  private static readonly VIEW_TYPE = 'cobweb.dashboard';
  private static current: DashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly staticAnalyzer: StaticAnalyzer,
    private readonly duplicateAnalyzer: DuplicateAnalyzer,
    private readonly gitAnalyzer: GitAnalyzer
  ) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /**
   * Creates or reveals the dashboard, then kicks off a background scan
   * that streams results into the webview as they arrive.
   */
  static async show(
    staticAnalyzer: StaticAnalyzer,
    duplicateAnalyzer: DuplicateAnalyzer,
    gitAnalyzer: GitAnalyzer,
    config: vscode.WorkspaceConfiguration,
    ignoreGlobs: string[]
  ): Promise<void> {
    const column = vscode.ViewColumn.One;

    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      await DashboardPanel.current.refresh(config, ignoreGlobs);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.VIEW_TYPE,
      '🕸️ Cobweb Dashboard',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    DashboardPanel.current = new DashboardPanel(panel, staticAnalyzer, duplicateAnalyzer, gitAnalyzer);
    await DashboardPanel.current.refresh(config, ignoreGlobs);
  }

  private async refresh(config: vscode.WorkspaceConfiguration, ignoreGlobs: string[]): Promise<void> {
    // Show loading state immediately
    this.panel.webview.html = this.buildLoadingHtml();

    const maxFiles = config.get<number>('maxFilesPerScan', 2000);
    const staleAfterDaysRaw = config.get<number>('staleAfterDays', 180);
    const staleAfterDays = Number.isFinite(staleAfterDaysRaw) && staleAfterDaysRaw > 0 ? staleAfterDaysRaw : 180;
    const respectExports = config.get<boolean>('respectExports', true);
    const duplicateBodyLengthTolerance = config.get<number>('duplicateBodyLengthTolerance', 0.15);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.panel.webview.html = this.buildErrorHtml('No workspace folder open.');
      return;
    }

    // Seed all workspace roots
    for (const folder of workspaceFolders) {
      this.staticAnalyzer.seedWorkspaceIfNeeded(folder.uri.fsPath, ignoreGlobs, maxFiles);
    }

    const allCandidates = this.staticAnalyzer.getAllCandidatesInSeededProject();

    // Build duplicate map
    const detectDuplicates = config.get<boolean>('detectDuplicates', true);
    if (detectDuplicates && !this.duplicateAnalyzer.hasCachedResults()) {
      this.duplicateAnalyzer.findSimilarFunctions(allCandidates, duplicateBodyLengthTolerance);
    }

    // Filter to zero-ref candidates
    const zeroCandidates = allCandidates.filter(
      c => c.candidate.referenceCountInProject === 0 || c.candidate.referenceCountInProject === -1
    );

    const rows: DashboardRow[] = [];
    for (const { filePath, candidate } of zeroCandidates) {
      const relPath = vscode.workspace.asRelativePath(filePath, false);
      const history = await this.gitAnalyzer.getSymbolHistory(filePath, candidate.name);
      const key = `${filePath.replace(/\\/g, '/')}::${candidate.name}`;
      const similarTo = detectDuplicates ? (this.duplicateAnalyzer.getSimilarFunctions(key) ?? []) : [];

      rows.push({
        name: candidate.name,
        filePath,
        relPath,
        startLine: candidate.startLine,
        referenceCountInProject: candidate.referenceCountInProject,
        isExported: candidate.isExported,
        history,
        similarTo,
      });
    }

    // Sort: stale + most days first
    rows.sort((a, b) => {
      const aAge = a.history.daysSinceLastModified ?? -1;
      const bAge = b.history.daysSinceLastModified ?? -1;
      return bAge - aAge;
    });

    this.panel.webview.html = this.buildDashboardHtml(rows, staleAfterDays, respectExports);
  }

  private buildLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 2rem; color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; align-items: center; justify-content: center; height: 80vh; flex-direction: column; gap: 1rem; }
    .spinner { width: 40px; height: 40px; border: 4px solid var(--vscode-focusBorder); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>Scanning workspace…</p>
</body>
</html>`;
  }

  private buildErrorHtml(msg: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>body { font-family: var(--vscode-font-family); padding: 2rem; color: var(--vscode-foreground); background: var(--vscode-editor-background); }</style>
</head>
<body><h2>⚠️ ${msg}</h2></body></html>`;
  }

  private buildDashboardHtml(rows: DashboardRow[], staleAfterDays: number, respectExports: boolean): string {
    const totalZeroRef = rows.length;
    const totalStale = rows.filter(r => (r.history.daysSinceLastModified ?? 0) >= staleAfterDays).length;
    const totalDuplicates = rows.filter(r => r.similarTo.length > 0).length;
    const totalExported = rows.filter(r => r.isExported).length;

    const rowsHtml = rows.map(row => {
      const isStale = (row.history.daysSinceLastModified ?? 0) >= staleAfterDays;
      const ageStr = row.history.daysSinceLastModified !== null && row.history.daysSinceLastModified !== undefined
        ? `${row.history.daysSinceLastModified}d ago`
        : '—';
      const authorStr = row.history.lastAuthor ?? '—';
      const dupStr = row.similarTo.length > 0
        ? `<span class="dup-badge" title="Similar to: ${row.similarTo.map(s => s.similarToName).join(', ')}">🧬 ${row.similarTo.length} dup</span>`
        : '';
      const exportBadge = row.isExported && respectExports
        ? `<span class="export-badge">📦 exported</span>`
        : '';
      const staleBadge = isStale ? `<span class="stale-badge">stale</span>` : '';
      const refStr = row.referenceCountInProject === -1 ? '?' : row.referenceCountInProject.toString();

      return `<tr class="${isStale ? 'stale-row' : ''}">
        <td class="name-cell"><span class="fn-name">${this.escapeHtml(row.name)}</span>${dupStr}${exportBadge}${staleBadge}</td>
        <td class="file-cell" title="${this.escapeHtml(row.filePath)}">${this.escapeHtml(row.relPath)}:${row.startLine}</td>
        <td class="age-cell">${ageStr}</td>
        <td class="author-cell">${this.escapeHtml(authorStr)}</td>
        <td class="refs-cell">${refStr}</td>
      </tr>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cobweb Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 1.5rem;
    }
    h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
    .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85rem; margin-bottom: 1.5rem; }

    .stats-row {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    .stat-card {
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border, #444));
      border-radius: 6px;
      padding: 0.75rem 1.25rem;
      min-width: 110px;
      text-align: center;
    }
    .stat-card .stat-number {
      font-size: 2rem;
      font-weight: 700;
      line-height: 1;
      color: var(--vscode-textLink-foreground);
    }
    .stat-card .stat-label {
      font-size: 0.72rem;
      color: var(--vscode-descriptionForeground);
      margin-top: 0.25rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .filter-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .filter-row input {
      padding: 0.35rem 0.6rem;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px;
      font-size: 0.85rem;
      min-width: 200px;
    }
    .filter-row label {
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 0.3rem;
      cursor: pointer;
      white-space: nowrap;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    thead th {
      text-align: left;
      padding: 0.5rem 0.6rem;
      border-bottom: 2px solid var(--vscode-panel-border, #444);
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }
    thead th:hover { color: var(--vscode-textLink-foreground); }
    td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      vertical-align: middle;
    }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    .stale-row .name-cell { color: var(--vscode-editorWarning-foreground, #e2a03f); }

    .fn-name { font-weight: 600; font-family: var(--vscode-editor-font-family); margin-right: 0.4rem; }
    .file-cell { color: var(--vscode-descriptionForeground); font-size: 0.78rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .age-cell, .refs-cell { text-align: right; white-space: nowrap; }
    .author-cell { white-space: nowrap; }

    .dup-badge, .export-badge, .stale-badge {
      display: inline-block;
      font-size: 0.65rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      margin-right: 0.3rem;
      vertical-align: middle;
      font-weight: 600;
    }
    .dup-badge { background: rgba(120,80,220,0.2); color: #b09ef0; border: 1px solid rgba(120,80,220,0.4); }
    .export-badge { background: rgba(60,130,220,0.15); color: #6ab0f5; border: 1px solid rgba(60,130,220,0.3); }
    .stale-badge { background: rgba(220,130,40,0.15); color: #e2a03f; border: 1px solid rgba(220,130,40,0.3); }

    .empty { text-align: center; padding: 3rem; color: var(--vscode-descriptionForeground); }
    .empty-icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>🕸️ Cobweb — Project Dashboard</h1>
  <p class="subtitle">Zero-reference functions across the whole workspace, sorted by staleness. Only TS/JS files (AST analysis).</p>

  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-number">${totalZeroRef}</div>
      <div class="stat-label">Zero-ref fns</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${totalStale}</div>
      <div class="stat-label">Stale (&gt;${staleAfterDays}d)</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${totalDuplicates}</div>
      <div class="stat-label">Near-dupes</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${totalExported}</div>
      <div class="stat-label">Exported</div>
    </div>
  </div>

  <div class="filter-row">
    <input type="text" id="filterInput" placeholder="Filter by name or file…" oninput="applyFilter()" />
    <label><input type="checkbox" id="onlyStale" onchange="applyFilter()"> Only stale</label>
    <label><input type="checkbox" id="onlyDupes" onchange="applyFilter()"> Only near-dupes</label>
    <label><input type="checkbox" id="hideExported" onchange="applyFilter()"> Hide exported</label>
  </div>

  ${rows.length === 0 ? `
  <div class="empty">
    <div class="empty-icon">✅</div>
    <div>No zero-reference functions found in the workspace.</div>
  </div>` : `
  <table id="dashTable">
    <thead>
      <tr>
        <th onclick="sortBy('name')">Function ▾</th>
        <th onclick="sortBy('file')">File : Line</th>
        <th onclick="sortBy('age')" style="text-align:right">Last Touched</th>
        <th onclick="sortBy('author')">Author</th>
        <th onclick="sortBy('refs')" style="text-align:right">Refs</th>
      </tr>
    </thead>
    <tbody id="tableBody">
${rowsHtml}
    </tbody>
  </table>`}

  <script>
    let sortKey = 'age';
    let sortAsc = false;

    const rawRows = ${JSON.stringify(rows.map(r => ({
      name: r.name,
      file: r.relPath + ':' + r.startLine,
      age: r.history.daysSinceLastModified ?? -1,
      author: r.history.lastAuthor ?? '',
      refs: r.referenceCountInProject,
      isStale: (r.history.daysSinceLastModified ?? 0) >= staleAfterDays,
      hasDup: r.similarTo.length > 0,
      isExported: r.isExported,
    })))};

    function applyFilter() {
      const text = document.getElementById('filterInput').value.toLowerCase();
      const onlyStale = document.getElementById('onlyStale').checked;
      const onlyDupes = document.getElementById('onlyDupes').checked;
      const hideExported = document.getElementById('hideExported').checked;
      const rows = document.querySelectorAll('#tableBody tr');
      rows.forEach((row, i) => {
        const r = rawRows[i];
        const matchText = !text || r.name.toLowerCase().includes(text) || r.file.toLowerCase().includes(text);
        const matchStale = !onlyStale || r.isStale;
        const matchDupe = !onlyDupes || r.hasDup;
        const matchExport = !hideExported || !r.isExported;
        row.style.display = (matchText && matchStale && matchDupe && matchExport) ? '' : 'none';
      });
    }

    function sortBy(key) {
      if (sortKey === key) { sortAsc = !sortAsc; } else { sortKey = key; sortAsc = true; }
      const tbody = document.getElementById('tableBody');
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const domRows = rows.map((el, i) => ({ el, data: rawRows[i] }));
      domRows.sort((a, b) => {
        let av = a.data[key] ?? '', bv = b.data[key] ?? '';
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortAsc ? cmp : -cmp;
      });
      domRows.forEach(({ el }) => tbody.appendChild(el));
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private dispose() {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
