import * as path from 'path';
import { Project, SourceFile, Node, FunctionDeclaration, MethodDeclaration, PropertyDeclaration } from 'ts-morph';

export interface SymbolCandidate {
  name: string;
  startLine: number;
  isExported: boolean;
  referenceCountInProject: number;
}

// Names commonly invoked by frameworks via convention/reflection rather than
// direct call sites — flagging these as "dead" would be a constant false positive.
const FRAMEWORK_LIFECYCLE_NAMES = new Set([
  // React class lifecycle
  'render', 'componentDidMount', 'componentWillUnmount', 'componentDidUpdate',
  'componentDidCatch', 'shouldComponentUpdate', 'getDerivedStateFromProps',
  // React hooks (arrow function style is very common for these)
  'useEffect', 'useMemo', 'useCallback', 'useReducer',
  // Angular
  'ngOnInit', 'ngOnDestroy', 'ngOnChanges', 'ngAfterViewInit', 'ngAfterContentInit',
  // NestJS
  'onModuleInit', 'onModuleDestroy',
  // Vue
  'setup', 'mounted', 'beforeDestroy', 'created', 'beforeMount', 'unmounted',
  // Generic
  'main', 'handler', 'default', 'middleware', 'reducer',
]);

/**
 * PRODUCTION FIX vs v0.1: findReferencesAsNodes() walks the whole loaded
 * project graph and is the single most expensive operation in this
 * extension. Re-running it on every provideCodeLenses call (which VS Code
 * fires on scroll/focus, not just on save) would make large files sluggish.
 * Results are now cached per (filePath, documentVersion) so unchanged
 * documents are free.
 */
export class StaticAnalyzer {
  private project: Project;
  private candidateCache = new Map<string, SymbolCandidate[]>(); // key: `${path}::${version}`

  /**
   * BUGFIX (v0.4.0): previously the ts-morph Project only ever contained
   * whichever files had individually been passed through
   * findCandidatesForDocument() — i.e. files the user happened to have open
   * in an editor tab. findReferencesAsNodes() can only see call sites inside
   * files that are actually IN the project, so a function called only from
   * a file the user hadn't opened yet was silently reported as 0 references
   * ("no internal callers") even though it was genuinely used. That directly
   * contradicted the "AST = accurate project-wide reference count" claim.
   *
   * seedWorkspaceIfNeeded() eagerly adds every source file under a workspace
   * root into the same Project (once per root, cheap thereafter), so
   * reference lookups see the whole project rather than only opened files.
   */
  private seededRoots = new Set<string>();

  constructor(tsConfigFilePath?: string) {
    this.project = tsConfigFilePath
      ? new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: false })
      : new Project({ useInMemoryFileSystem: false });
  }

  /**
   * Loads every TS/JS file under `workspaceRoot` into the shared ts-morph
   * Project (excluding node_modules/dist/build and any user ignoreGlobs), so
   * that reference counts reflect the whole project instead of only files
   * that happen to already be open. Safe to call repeatedly — a root is only
   * scanned once per StaticAnalyzer instance (i.e. per extension session),
   * and the actual work is skipped entirely if it was already seeded.
   *
   * Best-effort: if the glob scan fails for any reason (permissions,
   * pathological monorepo, etc.), we swallow the error and fall back to the
   * old lazy per-file behavior rather than breaking CodeLens rendering.
   */
  seedWorkspaceIfNeeded(workspaceRoot: string, ignoreGlobs: string[], maxFiles: number): void {
    const normalizedRoot = path.resolve(workspaceRoot);
    if (this.seededRoots.has(normalizedRoot)) return;
    this.seededRoots.add(normalizedRoot);

    try {
      const includePatterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'].map((p) =>
        path.join(normalizedRoot, p).split(path.sep).join('/')
      );
      // ts-morph's glob matcher supports leading "!" negation patterns.
      const defaultExcludes = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/out/**'];
      const excludePatterns = [...new Set([...defaultExcludes, ...ignoreGlobs])].map(
        (g) => `!${path.join(normalizedRoot, g).split(path.sep).join('/')}`
      );

      const added = this.project.addSourceFilesAtPaths([...includePatterns, ...excludePatterns]);

      if (added.length > maxFiles) {
        // Pathologically large workspace slipped past ignoreGlobs. Keep the
        // first maxFiles files already added and remove the rest to keep
        // memory and findReferencesAsNodes() latency bounded.
        for (const extra of added.slice(maxFiles)) {
          this.project.removeSourceFile(extra);
        }
      }
    } catch {
      // Seeding is an optimization, not a correctness requirement for the
      // currently-open file — swallow and continue with whatever is loaded.
    }
  }

  /** Clears the per-document candidate cache and forgets which workspace
   *  roots were seeded, so the next analysis re-seeds from scratch. Needed
   *  because ignoreGlobs (used to build the seed exclude patterns) can
   *  change after a root was already seeded, and because newly created
   *  files on disk won't be picked up by a root that's already marked seeded. */
  invalidateCache(): void {
    this.candidateCache.clear();
    this.seededRoots.clear();
  }

  findCandidatesForDocument(
    absolutePath: string,
    text: string,
    documentVersion: number
  ): SymbolCandidate[] {
    const cacheKey = `${absolutePath}::${documentVersion}`;
    const cached = this.candidateCache.get(cacheKey);
    if (cached) return cached;

    const sourceFile = this.addOrRefreshFile(absolutePath, text);
    const result = this.computeCandidates(sourceFile);

    if (this.candidateCache.size > 500) {
      const oldestKey = this.candidateCache.keys().next().value;
      if (oldestKey) this.candidateCache.delete(oldestKey);
    }
    this.candidateCache.set(cacheKey, result);
    return result;
  }

  private addOrRefreshFile(absolutePath: string, text: string): SourceFile {
    const existing = this.project.getSourceFile(absolutePath);
    if (existing) {
      existing.replaceWithText(text);
      return existing;
    }
    return this.project.createSourceFile(absolutePath, text, { overwrite: true });
  }

  /**
   * IMPORTANT LOOPHOLE HANDLED: a reference count of 0 does NOT necessarily
   * mean dead code. See README "What it deliberately does NOT claim" for the
   * full list (dynamic dispatch, external consumers, framework conventions,
   * barrel re-exports). This method surfaces a count, never a verdict.
   */
  private computeCandidates(sourceFile: SourceFile): SymbolCandidate[] {
    const candidates: SymbolCandidate[] = [];

    // ── 1. Traditional function declarations: function foo() {} ────────────────
    const functions = sourceFile.getFunctions();

    // ── 2. Class methods: class C { foo() {} } ────────────────────────────────
    const classes = sourceFile.getClasses();
    const methods: MethodDeclaration[] = classes.flatMap((c) => c.getMethods());

    const allDecls: (FunctionDeclaration | MethodDeclaration)[] = [...functions, ...methods];

    for (const decl of allDecls) {
      const name = decl.getName();
      if (!name || FRAMEWORK_LIFECYCLE_NAMES.has(name)) continue;

      const isExported = Node.isFunctionDeclaration(decl)
        ? decl.isExported() || decl.isDefaultExport()
        : false;

      let referenceCount: number;
      try {
        // findReferencesAsNodes() returns only USAGE sites — does NOT include
        // the declaration itself. Do not subtract 1 here.
        const refs = decl.findReferencesAsNodes();
        referenceCount = refs.length;
      } catch {
        referenceCount = -1;
      }

      candidates.push({
        name,
        startLine: decl.getStartLineNumber(),
        isExported,
        referenceCountInProject: referenceCount,
      });
    }

    // ── 3. Arrow functions / function expressions in variable declarations ──────
    //   const foo = () => {}          ← ArrowFunction
    //   const foo = async () => {}    ← ArrowFunction
    //   const foo = function() {}     ← FunctionExpression
    const arrowVarDecls = sourceFile.getVariableDeclarations().filter((v) => {
      const init = v.getInitializer();
      return init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init));
    });

    for (const varDecl of arrowVarDecls) {
      const name = varDecl.getName();
      if (!name || FRAMEWORK_LIFECYCLE_NAMES.has(name)) continue;

      const parentStatement = varDecl.getVariableStatement();
      const isExported = parentStatement?.isExported() ?? false;

      let referenceCount: number;
      try {
        const refs = varDecl.findReferencesAsNodes();
        referenceCount = refs.length;
      } catch {
        referenceCount = -1;
      }

      candidates.push({
        name,
        startLine: varDecl.getStartLineNumber(),
        isExported,
        referenceCountInProject: referenceCount,
      });
    }

    // ── 4. Class property arrow functions: class C { foo = () => {} } ─────────
    const classPropertyArrows: PropertyDeclaration[] = classes.flatMap((c) =>
      c.getProperties().filter((p) => {
        const init = p.getInitializer();
        return init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init));
      })
    );

    for (const prop of classPropertyArrows) {
      const name = prop.getName();
      if (!name || FRAMEWORK_LIFECYCLE_NAMES.has(name)) continue;

      let referenceCount: number;
      try {
        const refs = prop.findReferencesAsNodes();
        referenceCount = refs.length;
      } catch {
        referenceCount = -1;
      }

      candidates.push({
        name,
        startLine: prop.getStartLineNumber(),
        isExported: false,
        referenceCountInProject: referenceCount,
      });
    }

    return candidates;
  }
}
