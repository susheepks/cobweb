# 🕸️ Cobweb — Editor Compatibility Guide

> **TL;DR:** Cobweb works fully in **VS Code** and **Cursor**. It works in **Windsurf** with one minor caveat. It works in any **VS Code Remote / SSH / Dev Container** environment because `extensionKind` is set to `"workspace"`.

---

## VS Code (stable & insiders) ✅ Fully Supported

| Feature | Status | Notes |
|---|---|---|
| CodeLens (dead-code labels) | ✅ Full | Appears above every flagged function |
| `📋 Copy AI cleanup prompt` CodeLens | ✅ Full | Clipboard access via `vscode.env.clipboard` |
| `🕸️ Whole-file orphan` file-level lens | ✅ Full | Renders at line 1 |
| `🧬 Near-duplicate` lens | ✅ Full | TS/JS only |
| Project Dashboard (`cobweb.showDashboard`) | ✅ Full | Webview with sort/filter |
| Command Palette commands | ✅ Full | All 5 commands available |
| Remote / SSH / Dev Containers | ✅ Full | `extensionKind: ["workspace"]` — runs on the remote host, where the git repo and source files actually live |
| Codespaces | ✅ Full | Same as Remote/SSH |

**Minimum version:** VS Code `1.85.0`

---

## Cursor ✅ Fully Supported

Cursor is VS Code-compatible at the extension API level. All Cobweb features work identically to VS Code because Cursor:

- Ships the full VS Code extension host
- Supports `vscode.env.clipboard`
- Supports `WebviewPanel` with `enableScripts: true`
- Passes CodeLens registrations through unchanged

| Feature | Status | Notes |
|---|---|---|
| CodeLens labels | ✅ Full | — |
| AI cleanup prompt | ✅ Full | Works alongside Cursor's own AI; the prompt is for pasting into the Cursor chat or any external AI |
| Dashboard webview | ✅ Full | — |
| Whole-file orphan command | ✅ Full | — |
| Duplicate detection | ✅ Full | — |

**Tested against:** Cursor 0.40+ (VS Code 1.93 base)

### Cursor-specific tips

- The `📋 Copy AI cleanup prompt` CodeLens copies a Markdown-formatted prompt. You can paste it directly into **Cursor Chat** (`Ctrl/Cmd+L`) to get an in-editor AI review.
- Cursor's own AI will not automatically pick up Cobweb's signals — Cobweb augments Cursor, it doesn't replace it.

---

## Windsurf ✅ Supported (minor clipboard caveat)

Windsurf is built on a fork of VS Code's Open VSX ecosystem. Cobweb installs from a `.vsix` file and all core features work. There is **one known caveat**:

| Feature | Status | Notes |
|---|---|---|
| CodeLens labels | ✅ Full | — |
| Dashboard webview | ✅ Full | — |
| Whole-file orphan command | ✅ Full | — |
| Duplicate detection | ✅ Full | — |
| `📋 Copy AI cleanup prompt` | ⚠️ Partial | See note below |

### Clipboard caveat

`vscode.env.clipboard.writeText()` may silently fail in some Windsurf builds where the clipboard bridge between the webview host process and the OS is not fully wired up. This is a Windsurf platform issue, not a Cobweb issue.

**Workaround:** If the "copied to clipboard" toast appears but the clipboard is empty, open the **Output** panel → **Cobweb** channel (not currently implemented — add a `show prompt in output channel` fallback if this affects you). Alternatively, use VS Code or Cursor for the copy action.

**Tested against:** Windsurf 1.4+ (Codeium base)

---

## Remote Development (SSH, Dev Containers, WSL) ✅ Fully Supported

Because Cobweb sets `"extensionKind": ["workspace"]` in `package.json`, VS Code's Remote Extension Host runs Cobweb on the **remote machine** (or container), not locally. This means:

- `git log` runs against the repo on the remote, not your laptop
- File paths, workspace roots, and `ignoreGlobs` all resolve relative to the remote filesystem
- The ts-morph Project indexes the remote source files, so reference counts are accurate for the remote codebase

**No special setup needed.** Install Cobweb once; it will automatically load on the remote when you open a remote workspace.

---

## Open VSX (Cursor / Windsurf marketplace) 📦

Cobweb is published to both the **VS Code Marketplace** and **Open VSX Registry**. Use:

- **VS Code / GitHub Codespaces:** Search "Cobweb" in the Extensions panel
- **Cursor:** Search "Cobweb" in the Extensions panel (Cursor reads the VS Code Marketplace)
- **Windsurf:** Search "Cobweb" in the Extensions panel (Windsurf reads Open VSX)
- **Manual install:** Download the `.vsix` from the GitHub Releases page and run `Extensions: Install from VSIX…`

---

## Unsupported Environments

| Environment | Reason |
|---|---|
| VS Code Web (`vscode.dev`, `github.dev`) | The extension runs a git subprocess and spawns a ts-morph Project — both require a local Node.js process. Neither is available in the browser-only host. A future `"workspace"` + `"web"` dual-kind version is possible but not planned. |
| JetBrains IDEs (IntelliJ, WebStorm, etc.) | JetBrains uses a separate plugin system. Not compatible. |
| Neovim / Emacs | Not VS Code extensions. Not compatible. |
