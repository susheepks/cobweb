# Changelog

## 0.4.0 — Features: Dashboard, Duplicates, AI Prompts & Orphans

**Added:**
- **Phase 3: Project-Wide Dashboard (`cobweb.showDashboard`)** — a new webview panel listing every zero-ref function across all files, sortable and filterable by name, file, age, author, and duplicate status.
- **Phase 2: Duplicate Detection (TS/JS)** — flags functions with nearly identical structural logic anywhere in the project, ignoring variable names and whitespace (`cobweb.detectDuplicates`, `cobweb.duplicateBodyLengthTolerance`). Adds a new `🧬 Similar to...` CodeLens.
- **Phase 4: AI Cleanup Prompt** — a new inline CodeLens button (`📋 Copy AI cleanup prompt`) next to every flagged function to instantly copy a structured Markdown prompt (including source snippet and git history) to your clipboard, ready for AI review.
- **Phase 5: Whole-File Orphan Detection** — command (`cobweb.checkFileForOrphans`) that checks if every exported function in a TS/JS file has zero internal callers. Surfaces a `🕸️ Whole-file orphan` file-level CodeLens banner at line 1.
- **Phase 6: Remote Support & Compatibility Guide** — explicitly set `extensionKind: ["workspace"]` in `package.json` to ensure git operations and static analysis run correctly on the remote host (SSH, Dev Containers). Added `COMPATIBILITY.md` detailing support for VS Code, Cursor, and Windsurf.

**Fixed:**
- **Phase 1:** Capped `commitCountTouchingSymbol` at 5 in `gitAnalyzer` to prevent excessive history traversals on very active files.
- **Phase 1:** `seedWorkspaceIfNeeded` now eagerly seeds all files in the workspace (respecting `ignoreGlobs`), fixing a bug where reference counts only considered files that had been opened in the editor. Reference counts are now accurately project-wide.
- **Phase 1:** Restructured internal AST access to avoid leaking ts-morph nodes into the public CodeLens flow.

## 0.3.2 — Multi-Language Support

- Added regex-based fallback support for non-TS/JS languages (Python, Go, Rust, Java, C#, PHP, Ruby, C/C++, Swift, Kotlin, SQL, Vue, Shell, Dart, Scala).
- Added `respectExports` configuration to treat exported functions differently.
- Migrated codebase to `esbuild` for faster compilation.

## 0.2.0 — Production hardening pass

**Fixed (caught by the new test suite, not found by manual testing):**
- **Off-by-one in reference counting.** `findReferencesAsNodes()` returns only
  usage-site nodes in the installed ts-morph/TS-language-service version, not
  usage + declaration. The original code subtracted 1 "to exclude the
  declaration," which silently reclassified every function with exactly one
  real call site as having zero references — i.e. falsely flagged as dead.
  Fixed in `staticAnalyzer.ts`.
- **Git pickaxe search silently found nothing.** `simple-git`'s object-options
  form for `.log()` rendered the `-S` flag as `-S=<value>`, which git accepts
  without erroring but treats as a non-matching search string. Verified
  manually: `git log -S=foo` returns empty, `git log -Sfoo` returns real
  history. Every "last modified" date was silently null. Fixed by building
  raw argv instead of relying on the options-object mapping. `gitAnalyzer.ts`.

**Added:**
- LRU cache for git history lookups, keyed by (file, symbol, file mtime) —
  avoids re-spawning `git log` on every CodeLens re-render (scroll/focus, not
  just save).
- Reference-count cache keyed by (file, document version) — avoids re-running
  `findReferencesAsNodes()` on every re-render.
- Concurrency limit (max 4 concurrent git subprocesses) to avoid exhausting
  process/file-descriptor limits on files with many candidates.
- `RepoRegistry`: resolves the correct git root per file by walking up the
  directory tree, replacing the old "bind to workspaceFolders[0] once" logic.
  Fixes multi-root workspaces, nested repos, submodules, and workspace
  folders opened at a subdirectory of the actual repo root.
- Real test suite (11 tests, mocha + chai) covering both pure-logic modules
  against a real temporary git repository (not mocked) and a real in-memory
  ts-morph project.
- `cobweb.refresh` command now also invalidates the git cache, not
  just the CodeLens display.

**Known limitations carried forward from 0.1.0** — see README "Known
Limitations": language support (TS/JS only), renamed-and-moved-in-same-commit
files, and untested behavior on very large real-world monorepos.

## 0.1.0 — Initial scaffold
Static reference counting + git blame/log overlay as CodeLens. Single-repo,
single-root workspace only. No caching (rebuilt from scratch every render).
