# 🕸️ Cobweb — Git-Based Dead Code Detector

[![VS Code](https://img.shields.io/badge/VS%20Code-Fully%20Supported-blue?logo=visualstudiocode)](#) [![Cursor](https://img.shields.io/badge/Cursor-Fully%20Supported-black)](#) [![Windsurf](https://img.shields.io/badge/Windsurf-Supported-blue)](#) [![Remote/SSH](https://img.shields.io/badge/Remote%2FSSH-Fully%20Supported-green)](#)

> **Find functions nobody calls. Know when they were last touched. Decide if they should go.**

Cobweb is a VS Code extension that sits quietly in your editor and flags **stale, possibly dead functions** by combining two signals:

1. **Static analysis** — how many places in your project call a given function
2. **Git history** — when it was last changed, and by whom

Everything runs **100% locally** against the repo already open in your editor — no servers, no accounts, no telemetry.

---

## Table of Contents

- [Why Cobweb](#why-cobweb)
- [Features](#features)
- [Compatibility](#compatibility)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Reading the CodeLens Labels](#reading-the-codelens-labels)
- [Supported Languages](#supported-languages)
- [Configuration](#configuration)
- [Commands](#commands)
- [What Cobweb Does NOT Claim](#what-cobweb-does-not-claim)
- [Building From Source](#building-from-source)
- [Running Tests](#running-tests)
- [Privacy](#privacy)
- [License](#license)

---

## Why Cobweb

Every codebase accumulates functions that used to matter and quietly stopped being called. Cobweb answers three questions right where you're already reading code, with no dashboards to check:

- Is anything in the project actually calling this function?
- If not, how long has it been sitting there untouched?
- Who wrote it (or last touched it), so you know who to ask before deleting it?

## Features

- 🔍 **Dead code detection** — flags functions with zero internal references
- 📅 **Git-backed staleness** — shows how many days ago a function was last touched
- 👤 **Author attribution** — shows who last modified the function
- 🏷️ **Smart export awareness** — treats exported functions differently, since they may have external callers
- 🧬 **Duplicate detection (TS/JS only)** — flags functions with nearly identical structural logic anywhere in the project, ignoring variable names and whitespace
- 📊 **Project-wide dashboard** — one-command view of every zero-ref function across all files, with filtering, sorting, and duplicate highlights
- 📋 **AI cleanup prompt** — one-click to copy a structured Markdown prompt (name, file, git history, source snippet, and review questions) to your clipboard, ready to paste into any AI chat
- 🕸️ **Whole-file orphan detection** — detects when every single function in a TS/JS file has zero internal callers, showing a file-level CodeLens banner and a command to get an AI-ready summary
- ⚡ **Incremental caching** — results are cached per file version; re-runs only when code actually changes
- 🌐 **20 languages supported** — TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C/C++, Swift, Kotlin, SQL, Vue, Shell, Dart, Scala, and more
- 🔒 **Privacy first** — zero network calls, zero data collection

## Compatibility

Cobweb is fully supported in **VS Code**, **Cursor**, **Windsurf**, and **Remote / SSH / Dev Container** environments.

See the full **[Editor Compatibility Guide](COMPATIBILITY.md)** for details, including minor clipboard caveats in Windsurf.

## How It Works

For every function or method in the open file, Cobweb:

1. **Counts references** — how many times it's called elsewhere in the project
2. **If references = 0** → runs `git log -S<name>` against your local git history to find:
   - The date it was last modified
   - The author who last touched it
   - How many days ago that was
3. **Renders an inline CodeLens** directly above the function declaration, so the signal lives right next to the code it describes

## Installation

**From a packaged extension:**

1. Download or build the `.vsix` file (see [Building From Source](#building-from-source))
2. In VS Code, open the **Extensions** panel
3. Click the **···** menu → **Install from VSIX...**
4. Select the `.vsix` file

Cobweb activates automatically on supported file types in any folder that is a git repository — no setup required.

## Reading the CodeLens Labels

Cobweb shows one of the following labels above each flagged function.

### `⚠️ Possibly dead code · last touched 412d ago by jsmith · stale`
The function has **no callers inside the project** and **hasn't been touched in a long time** (past the `staleAfterDays` threshold).
- Nobody calls it → likely dead
- Nobody touched it in 412 days → likely forgotten
- **Action:** consider deleting it, or write a test that proves it's still needed

### `📦 Exported, no internal callers · last touched 90d ago by susheepks`
The function is **exported** (part of the public API) and has **no callers inside this project** — but external packages or consumers may still use it.
- Safe to keep if it's genuinely public API
- Worth reviewing if it's an old utility nobody imports anymore
- Controlled by the `cobweb.respectExports` setting

### `⚠️ Possibly dead code · no git history found for this symbol`
Zero refs, but git has no record of this function being added or changed.
- May have been added in a commit that renamed or moved the file
- May be in a shallow clone with incomplete history

### `⚠️ Possibly dead code · git history unavailable`
Zero refs, and there's **no git repo** for this file.
- Cobweb still flags the zero-ref signal
- Staleness can't be determined without git

### `❓ refs unknown · last touched 55d ago by alice`
Cobweb **couldn't count references** for this function (a complex expression the analyzer couldn't resolve), but it did find git history.
- Treat this as a hint, not a verdict
- Check manually whether the function is called anywhere

### `📋 Copy AI cleanup prompt`
A second inline CodeLens button that appears next to every flagged function. Click it to copy a structured Markdown prompt to your clipboard. The prompt includes:
- The function’s name, file path, reference count, and export status
- Its git history (last touched, by whom, how many days ago)
- The first ~50 lines of the function’s source code
- Four specific review questions for an AI (dead or live? what did it do? how to refactor? etc.)

Paste it into any AI chat (ChatGPT, Claude, Gemini, Copilot Chat, etc.) to get an instant second opinion.

### `🧬 Similar to <name> in <relative path> · review for duplication`
Cobweb found another function in the project that has the exact same control flow and parameter count, and its structural body (ignoring variable names) matches within a small length tolerance.
- Only fires for TS/JS functions with at least 3 statements (trivial getters are ignored).
- Does not flag framework lifecycle methods (e.g. `render`, `ngOnInit`).
- **Action:** Consider refactoring to a shared utility.

### `· stale` suffix
Appended to any label when the function hasn't been touched for more than `cobweb.staleAfterDays` (default **180 days**). A zero-ref function that is also stale is the strongest dead-code signal Cobweb can give you.

## Supported Languages

| Language | Analysis Type | What's Detected |
|---|---|---|
| TypeScript / TSX | ✅ AST (ts-morph) | Functions, arrow functions, methods, class properties |
| JavaScript / JSX | ✅ AST (ts-morph) | Functions, arrow functions, methods, class properties |
| Python | 🔤 Regex | `def` and `async def` functions |
| Go | 🔤 Regex | `func` declarations and methods |
| Rust | 🔤 Regex | `fn` and `pub fn` functions |
| Java | 🔤 Regex | Public/private/protected methods |
| C# | 🔤 Regex | Methods with access modifiers |
| PHP | 🔤 Regex | `function` and class methods |
| Ruby | 🔤 Regex | `def` and `def self.` methods |
| C / C++ | 🔤 Regex | Function definitions |
| Swift | 🔤 Regex | `func` declarations |
| Kotlin | 🔤 Regex | `fun` declarations |
| SQL | 🔤 Regex | `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE VIEW` |
| Vue | 🔤 Regex | Methods inside `<script>` blocks |
| Shell / Bash | 🔤 Regex | `function_name() { }` declarations |
| Dart | 🔤 Regex | Function declarations |
| Scala | 🔤 Regex | `def` methods |

> **AST** = accurate, project-wide reference count.
> **Regex** = in-file reference count only (approximate — shown as `0 in-file refs`).

## Configuration

Set these in your VS Code `settings.json`:

| Setting | Default | Description |
|---|---|---|
| `cobweb.staleAfterDays` | `180` | Days of inactivity before a symbol is marked `stale` |
| `cobweb.ignoreGlobs` | `["**/node_modules/**", "**/dist/**", "**/*.test.*", "**/*.spec.*"]` | File patterns to skip |
| `cobweb.respectExports` | `true` | Show `📦 Exported` label instead of `⚠️` for exported symbols |
| `cobweb.maxFilesPerScan` | `2000` | Safety cap on files analyzed per scan (protects monorepos) |
| `cobweb.detectDuplicates` | `true` | Enable/disable structural duplicate detection (TS/JS only) |
| `cobweb.duplicateBodyLengthTolerance` | `0.15` | Allowed difference ratio between duplicate bodies (e.g. `0.15` = 15% difference) |

## Commands

Run these from the Command Palette (`Cmd/Ctrl+Shift+P`):

| Command | Description |
|---|---|
| `Cobweb: Refresh Analysis` | Clears all caches and re-runs analysis on open files |
| `Cobweb: Show Details for Symbol` | Opens a detail popup with full git + reference info for a symbol |
| `Cobweb: Show Project Dashboard` | Opens a project-wide webview panel listing every zero-ref function, sortable and filterable by name, file, age, author, and duplicate status |
| `Cobweb: Copy AI Cleanup Prompt for Symbol` | Triggered via the inline `📋 Copy AI cleanup prompt` CodeLens; copies a ready-to-paste Markdown prompt to the clipboard |
| `Cobweb: Check File for Whole-File Orphan` | Checks the active TS/JS file: if every function has zero callers, reports it as a whole-file orphan and optionally copies an AI review prompt |

## What Cobweb Does NOT Claim

**Zero refs ≠ definitely dead.** Cobweb surfaces a signal — you make the call. It cannot see:

- **Dynamic calls** — `obj[methodName]()`, string-based dispatch, `eval`
- **External consumers** — if your function ships in a published npm package or is used by another repo
- **Framework conventions** — lifecycle methods invoked by React, Angular, Vue, NestJS, etc. (a common list is pre-excluded; extend `ignoreGlobs` for your framework)
- **Test-only usage** — if test files are excluded via `ignoreGlobs` (the default)
- **Cross-file references in non-TS languages** — regex-based languages only count in-file references
- **Whole-file orphan detection is function-scoped only** — a file whose exports are entirely classes, constants, types, interfaces, or barrel re-exports (`export { x } from './x'`) produces zero function candidates and is therefore invisible to the whole-file orphan check. It will not be falsely flagged, but it also cannot be detected as orphaned by this feature. Use your bundler's tree-shaking output or an import-graph tool for that.

Use Cobweb's flags as a starting point for a code review, not as an automatic delete instruction.

## Building From Source

```bash
git clone https://github.com/susheepks/cobweb.git
cd cobweb
npm install
npm run compile        # TypeScript + esbuild → dist/extension.js
npm run package        # produces cobweb-x.x.x.vsix
```

To install locally without publishing: **Extensions panel** → **···** menu → **Install from VSIX...** → select the `.vsix`.

## Running Tests

```bash
npm test                   # Unit tests (mocha + chai) — no VS Code needed
npm run test:integration   # Full integration tests inside a real VS Code instance
```

Tests cover: `GitAnalyzer` (against real git repos), `StaticAnalyzer` (AST candidates), and arrow function detection.

## Privacy

Cobweb makes **zero network requests**. It runs entirely locally:

- [`ts-morph`](https://github.com/dsherret/ts-morph) — TypeScript/JavaScript AST analysis, in-process
- [`simple-git`](https://github.com/steveukx/git-js) — shells out to your local `git` binary only
- No analytics, no crash reporting, no telemetry of any kind

## License

MIT © [susheepks](https://github.com/susheepks)