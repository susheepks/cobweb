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

  constructor(tsConfigFilePath?: string) {
    this.project = tsConfigFilePath
      ? new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: false })
      : new Project({ useInMemoryFileSystem: false });
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
