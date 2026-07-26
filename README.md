# Cobweb

Flags functions/methods with **zero internal references** and shows how long
ago they were last touched in git — surfaced as an inline CodeLens, right
above the declaration. No servers, no accounts, no telemetry: everything runs
locally against the repo already open in your editor.

## What it does

For each top-level function and class method in TypeScript/JavaScript files:

1. Static analysis (`ts-morph`) counts references within the currently loaded
   project.
2. If references == 0, git history (`simple-git`, using `git log -S`) is
   checked for when the symbol last changed and who touched it.
3. A CodeLens renders above the declaration, e.g.:
   `⚠️ Possibly dead code · last touched 412d ago by jsmith · stale`

## What it deliberately does NOT claim

Zero internal references is a signal, not a verdict. This extension never
says "delete this." It can't see:
- Dynamic/reflective calls (`obj[name]()`, string-based dispatch)
- Consumers outside this repo (published npm packages, monorepo packages
  loaded by other repos)
- Framework-invoked lifecycle methods (a common list is excluded by default —
  see `FRAMEWORK_LIFECYCLE_NAMES` in `src/staticAnalyzer.ts` — but you may
  need to extend this list for your framework)
- Test-only usage if test files are excluded via `ignoreGlobs`

Exported symbols are labeled "📦 Exported, no internal callers" instead of
"dead code" by default (`cobweb.respectExports`).

## Known limitations (v0.1)

- **Multi-root workspaces**: only the first workspace folder's git repo is
  analyzed. Independent repos per folder is a v0.2 item.
- **Shallow clones**: `git log -S` on a shallow clone returns partial history.
  The extension detects this and shows a one-time warning in its output
  channel rather than silently giving wrong dates. Run `git fetch --unshallow`
  for accurate results.
- **Renamed/moved files**: `--follow` is used, but a function renamed *and*
  moved in the same commit can still lose history continuity — a known git
  limitation, not specific to this tool.
- **Non-git workspaces**: staleness scoring is disabled; only static
  reference counts are shown.
- **Language support**: TypeScript/JavaScript only in v0.1. Python/Go/etc.
  would need a different static-analysis backend (see Roadmap).
- **Large monorepos**: capped at `cobweb.maxFilesPerScan` (default
  2000) files per scan as a performance safety valve.

## Testing

Two tiers:

```bash
npm test               # unit tests — pure logic, no VS Code needed, run anywhere
npm run test:integration   # integration tests — real VS Code extension host
```

**Unit tests** (11 tests, mocha + chai): run against real fixtures — a
temporary `git init`'d repo (not mocked) for `GitAnalyzer`, and a real
in-memory `ts-morph` project for `StaticAnalyzer`. These were run and verified
passing during development. The two real bugs fixed in v0.2.0 (see
CHANGELOG) were both cases where the code *looked* correct but a mocked test
would have mocked away the exact behavior that was wrong.

**Integration tests** (`@vscode/test-electron`): activate the real extension
inside an actual downloaded VS Code instance, open a dynamically-built
fixture workspace (git repo generated fresh in a temp dir per run — never
committed, since a nested `.git` can't safely live inside this repo), and
assert the CodeLens provider's real output end-to-end. **Note on how this was
verified:** the fixture-generation logic was run and confirmed working
standalone; the full run (which requires downloading a VS Code binary from
`update.code.visualstudio.com`) could not be executed in the sandboxed
environment used to build this scaffold, since that domain isn't network-
reachable there. It's wired into CI (`.github/workflows/publish.yml`, with
`xvfb-run` for headless Linux) where GitHub Actions has full internet access,
and will also run locally on any machine with normal internet access via
`npm run test:integration`. Confirm it passes in CI or locally before your
first real release.

A note on `npm audit`: it will report a handful of moderate/high findings.
All of them are in dev-only tooling (`vsce`, `esbuild`'s dev server, `mocha`'s
transitive deps, `sharp`'s build chain) that never ships in the packaged
`.vsix` — `.vscodeignore` excludes `node_modules` and dev-only files from the
published package.

## Privacy

100% local. No network calls, no data collection, no external servers. The
only "network" activity is git itself talking to your already-configured
remote (which you controlled before installing this).

## Building from source

```bash
npm install
npm run compile        # type-check + esbuild bundle -> dist/extension.js
npm run package         # produces a .vsix you can install locally or share
```

To try it locally without publishing: in VS Code, `Extensions` panel → `...`
menu → `Install from VSIX...` → select the generated `.vsix`.

## Publishing (free, no infra)

Two free distribution channels, both handled by `.github/workflows/publish.yml`
on a `git tag v*` push:

- **VS Code Marketplace** — requires a free Azure DevOps org + a Personal
  Access Token, then `vsce publish` (or the `publish:marketplace` npm script).
- **Open VSX** — the open marketplace used by VSCodium, Gitpod, Eclipse Theia,
  etc. Requires a free Eclipse Foundation account + token, then `ovsx publish`.

Both are free forever for open extensions; GitHub Actions is free for public
repos, so the entire pipeline — build, test, package, publish — costs nothing.

## License

MIT
