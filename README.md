# Cobweb — Git-Based Dead Code Detector

> **Find functions nobody calls. Know when they were last touched. Decide if they should go.**

Cobweb is a VS Code extension that sits silently in your editor and surfaces **stale, possibly dead functions** using two signals:
1. **Static analysis** — counts how many places in your project call each function
2. **Git history** — checks when it was last modified and by whom

No servers. No accounts. No telemetry. Everything runs 100% locally against the repo already open in your editor.

---

## ✨ Features

- 🔍 **Dead code detection** — flags functions with zero internal references
- 📅 **Git-backed staleness** — shows how many days ago a function was last touched
- 👤 **Author attribution** — shows who last modified the function
- 🏷️ **Smart export awareness** — treats exported functions differently (they may have external callers)
- ⚡ **Incremental caching** — results are cached per file version; re-runs only when code changes
- 🌐 **20 languages supported** — TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C/C++, Swift, Kotlin, SQL, Vue, Shell, Dart, Scala, and more
- 🔒 **Privacy first** — zero network calls, zero data collection

---

## 🔬 How It Works

For each function/method in your file, Cobweb:

1. **Counts references** — how many times it is called within the project
2. **If references = 0** → fetches git history using `git log -S<name>` to find:
   - The date it was last modified
   - The author who last touched it
   - How many days ago that was
3. **Renders a CodeLens** inline, right above the function declaration

---

## 📖 Reading the CodeLens Labels

Cobweb shows one of the following labels above each flagged function:

### `⚠️ Possibly dead code · last touched 412d ago by jsmith · stale`
The function has **no callers inside the project** and has **not been touched in a long time** (past the `staleAfterDays` threshold).
- Nobody calls it → likely dead
- Nobody touched it in 412 days → likely forgotten
- **Action**: Consider deleting it or writing a test for it

---

### `📦 Exported, no internal callers · last touched 90d ago by susheepks`
The function is **exported** (public API) and has **no callers inside this project** — but external packages or consumers may still use it.
- Safe to keep if it's part of your public API
- Worth reviewing if it's an old utility nobody imports anymore
- Controlled by the `cobweb.respectExports` setting

---

### `⚠️ Possibly dead code · no git history found for this symbol`
Zero refs, but git has no record of this function being added/changed.
- May have been added in a commit that renamed/moved the file
- May be in a shallow clone with incomplete history

---

### `⚠️ Possibly dead code · git history unavailable`
Zero refs, and there's **no git repo** for this file.
- Cobweb still flags the zero-ref signal
- Staleness cannot be determined without git

---

### `❓ refs unknown · last touched 55d ago by alice`
Cobweb **could not count references** for this function (complex expression that the analyzer couldn't resolve), but it still found git history.
- Treat as a hint, not a verdict
- Check manually if the function is called anywhere

---

### `· stale` suffix
Appended to any label when the function hasn't been touched for more than `cobweb.staleAfterDays` (default: **180 days**). A zero-ref function that is also stale is the strongest dead code signal.

---

## 🌐 Supported Languages

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

> **AST** = accurate project-wide reference count  
> **Regex** = in-file reference count (approximate — labeled as `0 in-file refs`)

---

## ⚙️ Configuration

| Setting | Default | Description |
|---|---|---|
| `cobweb.staleAfterDays` | `180` | Days of inactivity before a symbol is marked `stale` |
| `cobweb.ignoreGlobs` | `["**/node_modules/**", "**/dist/**", "**/*.test.*", "**/*.spec.*"]` | File patterns to skip |
| `cobweb.respectExports` | `true` | Show `📦 Exported` label instead of `⚠️` for exported symbols |
| `cobweb.maxFilesPerScan` | `2000` | Safety cap on files analysed per scan (protects monorepos) |

---

## ⚠️ What Cobweb Does NOT Claim

**Zero refs ≠ definitely dead.** Cobweb surfaces a signal — you make the call. It cannot see:

- **Dynamic calls** — `obj[methodName]()`, string-based dispatch, eval
- **External consumers** — if your function is in a published npm package or used by another repo
- **Framework conventions** — lifecycle methods called by React, Angular, Vue, NestJS, etc. (a common list is pre-excluded; extend `ignoreGlobs` for your framework)
- **Test-only usage** — if test files are excluded via `ignoreGlobs` (the default)
- **Cross-file references in non-TS languages** — regex-based languages count in-file refs only

---

## 🔧 Commands

| Command | Description |
|---|---|
| `Cobweb: Refresh Analysis` | Clears all caches and re-runs analysis on open files |
| `Cobweb: Show Details for Symbol` | Opens a detail popup with full git + ref info for a symbol |

---

## 🛠️ Building From Source

```bash
git clone https://github.com/susheepks/cobweb.git
cd cobweb
npm install
npm run compile        # TypeScript + esbuild → dist/extension.js
npm run package        # produces cobweb-x.x.x.vsix
```

To install locally without publishing:
`Extensions panel` → `···` menu → `Install from VSIX...` → select the `.vsix`

---

## 🧪 Running Tests

```bash
npm test                   # Unit tests (mocha + chai) — no VS Code needed
npm run test:integration   # Full integration tests inside a real VS Code instance
```

Tests cover: GitAnalyzer (real git repos), StaticAnalyzer (AST candidates), and arrow function detection.

---

## 🔒 Privacy

Cobweb makes **zero network requests**. It runs entirely locally:
- `ts-morph` — TypeScript/JavaScript AST in-process
- `simple-git` — shells out to your local `git` binary only
- No analytics, no crash reporting, no telemetry of any kind

---

## 📄 License

MIT © susheepks
