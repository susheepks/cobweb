import { LRUCache } from 'lru-cache';
import { SymbolCandidate } from './staticAnalyzer';

// ─── Per-language configuration ──────────────────────────────────────────────

interface LanguageConfig {
  /** Global regex with exactly one capture group: the symbol/function name. */
  symbolPattern: RegExp;
  /** Which capture group (1-indexed) holds the name. */
  nameGroup: number;
  /** Framework/runtime lifecycle names to unconditionally skip. */
  lifecycleNames: Set<string>;
  /** If true, mark all symbols as exported (e.g. SQL objects are always public). */
  alwaysExported?: boolean;
  /** If true, uppercase-first name → exported (Go convention). */
  exportByCase?: boolean;
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  // ── Python ──────────────────────────────────────────────────────────────────
  python: {
    symbolPattern: /^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      '__init__', '__str__', '__repr__', '__len__', '__del__',
      '__enter__', '__exit__', '__iter__', '__next__', '__call__',
      '__getitem__', '__setitem__', '__contains__', '__eq__', '__hash__',
      'setUp', 'tearDown', 'setUpClass', 'tearDownClass', 'main',
    ]),
  },

  // ── Go ──────────────────────────────────────────────────────────────────────
  go: {
    // Matches both top-level funcs and methods. Exported = uppercase-first.
    symbolPattern: /^func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?([A-Za-z_]\w*)\s*[(<]/gm,
    nameGroup: 1,
    lifecycleNames: new Set(['main', 'init', 'ServeHTTP', 'Error', 'String']),
    exportByCase: true,
  },

  // ── Rust ────────────────────────────────────────────────────────────────────
  rust: {
    symbolPattern: /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*[<(]/gm,
    nameGroup: 1,
    lifecycleNames: new Set(['main', 'new', 'default', 'clone', 'drop', 'fmt', 'from', 'into']),
  },

  // ── Java ────────────────────────────────────────────────────────────────────
  java: {
    symbolPattern:
      /(?:(?:public|private|protected|static|final|synchronized|native|abstract)\s+)+(?:[\w<>[\]]+\s+)+(\w+)\s*\(/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'main', 'toString', 'hashCode', 'equals', 'compareTo',
      'run', 'call', 'execute', 'doGet', 'doPost', 'service',
      'init', 'destroy', 'configure',
    ]),
  },

  // ── C# ──────────────────────────────────────────────────────────────────────
  csharp: {
    symbolPattern:
      /(?:(?:public|private|protected|internal|static|virtual|override|async|abstract|sealed|new)\s+)+(?:[\w<>[\]?,\s]+\s+)(\w+)\s*\(/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'Main', 'ToString', 'GetHashCode', 'Equals', 'Dispose',
      'OnInit', 'OnInitialized', 'OnDestroy', 'OnParametersSet',
      'Configure', 'ConfigureServices', 'BuildWebHost',
    ]),
  },

  // ── PHP ─────────────────────────────────────────────────────────────────────
  php: {
    symbolPattern: /(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)\s*\(/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      '__construct', '__destruct', '__toString', '__get', '__set',
      '__isset', '__unset', '__clone', '__invoke',
      'index', 'create', 'store', 'show', 'edit', 'update', 'destroy',
    ]),
  },

  // ── Ruby ────────────────────────────────────────────────────────────────────
  ruby: {
    symbolPattern: /^[ \t]*def\s+(?:self\.)?(\w+[?!]?)/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'initialize', 'to_s', 'to_str', 'inspect', 'call',
      'perform', 'execute', 'run', 'up', 'down',
    ]),
  },

  // ── C ───────────────────────────────────────────────────────────────────────
  c: {
    symbolPattern: /^(?:static\s+|inline\s+)?(?:[\w*]+\s+)+(\w+)\s*\([^;)]*\)\s*\{/gm,
    nameGroup: 1,
    lifecycleNames: new Set(['main', 'init', 'setup', 'cleanup', 'free']),
  },

  // ── C++ ─────────────────────────────────────────────────────────────────────
  cpp: {
    symbolPattern:
      /^(?:(?:static|inline|virtual|explicit|constexpr|override|final)\s+)*(?:[\w*:<>~]+\s+)+(\w+)\s*\([^;{]*\)\s*(?:const\s*)?(?:noexcept\s*)?\{/gm,
    nameGroup: 1,
    lifecycleNames: new Set(['main', 'operator', 'toString', 'swap']),
  },

  // ── Swift ───────────────────────────────────────────────────────────────────
  swift: {
    symbolPattern:
      /(?:(?:private|public|internal|fileprivate|open|override|static|class|final)\s+)*func\s+(\w+)\s*[<(]/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'viewDidLoad', 'viewWillAppear', 'viewDidAppear', 'viewWillDisappear',
      'viewDidDisappear', 'init', 'deinit', 'awakeFromNib',
      'encode', 'decode', 'applicationDidFinishLaunching',
    ]),
  },

  // ── Kotlin ──────────────────────────────────────────────────────────────────
  kotlin: {
    symbolPattern:
      /(?:(?:private|public|internal|protected|override|suspend|inline|open|abstract)\s+)*fun\s+(\w+)\s*[<(]/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'onCreate', 'onStart', 'onResume', 'onPause', 'onStop',
      'onDestroy', 'onCreateView', 'main', 'invoke',
    ]),
  },

  // ── SQL ─────────────────────────────────────────────────────────────────────
  sql: {
    symbolPattern:
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|VIEW)\s+(?:\w+\.)?(\w+)/gim,
    nameGroup: 1,
    lifecycleNames: new Set(),
    alwaysExported: true,
  },

  // ── Vue (Options API — methods inside <script>) ──────────────────────────────
  vue: {
    symbolPattern: /^\s{2,}(\w+)\s*\([^)]*\)\s*\{/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'beforeCreate', 'created', 'beforeMount', 'mounted',
      'beforeUpdate', 'updated', 'beforeDestroy', 'destroyed',
      'setup', 'data',
    ]),
  },

  // ── Shell / Bash ─────────────────────────────────────────────────────────────
  shellscript: {
    symbolPattern: /^(\w+)\s*\(\s*\)\s*\{/gm,
    nameGroup: 1,
    lifecycleNames: new Set(['main', 'init', 'setup', 'cleanup', 'usage', 'help']),
  },

  // ── Dart ────────────────────────────────────────────────────────────────────
  dart: {
    symbolPattern:
      /(?:(?:static|async|Future|Stream|void|int|String|bool|double|dynamic|\w+\??)\s+)+(\w+)\s*\(/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'build', 'initState', 'dispose', 'setState',
      'main', 'createState', 'didChangeDependencies', 'didUpdateWidget',
    ]),
  },

  // ── Scala ───────────────────────────────────────────────────────────────────
  scala: {
    symbolPattern: /(?:def|override def)\s+(\w+)\s*[[(]/gm,
    nameGroup: 1,
    lifecycleNames: new Set([
      'main', 'apply', 'unapply', 'toString', 'hashCode', 'equals',
      'receive', 'preStart', 'postStop',
    ]),
  },
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count whole-word occurrences of `name` in `text`, excluding the match
 * at `definitionOffset` (the declaration line itself).
 */
function countInFileRefs(text: string, name: string, definitionOffset: number): number {
  const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    // The definition site: the occurrence whose index is very close to the
    // match start — skip it so we don't count the declaration as a reference.
    if (Math.abs(m.index - definitionOffset) <= name.length + 10) continue;
    count++;
  }
  return count;
}

// ─── RegexAnalyzer ───────────────────────────────────────────────────────────

/**
 * Language-agnostic symbol extractor using per-language regex patterns.
 * Used for all languages that ts-morph cannot parse (everything except
 * TypeScript / JavaScript / JSX / TSX).
 *
 * Reference counts are IN-FILE ONLY (occurrences within the same document),
 * not project-wide. CodeLens labels reflect this with "(in-file)" notation.
 */
export class RegexAnalyzer {
  private cache = new LRUCache<string, SymbolCandidate[]>({ max: 300 });

  findCandidatesForDocument(
    absolutePath: string,
    text: string,
    languageId: string,
    documentVersion: number
  ): SymbolCandidate[] {
    const cacheKey = `${absolutePath}::${languageId}::${documentVersion}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const result = this.computeCandidates(text, languageId);
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Returns true if this analyzer has a regex pattern for the given language. */
  static supports(languageId: string): boolean {
    return languageId in LANGUAGE_CONFIGS;
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  private computeCandidates(text: string, languageId: string): SymbolCandidate[] {
    const config = LANGUAGE_CONFIGS[languageId];
    if (!config) return [];

    // Vue: only analyse the content inside <script> tags
    let analysisText = text;
    if (languageId === 'vue') {
      const scriptMatch = text.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      if (!scriptMatch) return [];
      analysisText = scriptMatch[1];
    }

    const candidates: SymbolCandidate[] = [];
    const seen = new Set<string>(); // deduplicate overloaded/repeated names

    // Fresh regex instance so lastIndex is always reset
    const pattern = new RegExp(config.symbolPattern.source, config.symbolPattern.flags);

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(analysisText)) !== null) {
      const name = match[config.nameGroup];
      if (!name || config.lifecycleNames.has(name) || seen.has(name)) continue;
      seen.add(name);

      // 1-indexed line number of the definition
      const startLine = analysisText.slice(0, match.index).split('\n').length;

      // In-file reference count
      const inFileRefs = countInFileRefs(analysisText, name, match.index);

      // Export detection
      const isExported =
        config.alwaysExported === true
          ? true
          : config.exportByCase === true
          ? /^[A-Z]/.test(name)
          : false;

      candidates.push({
        name,
        startLine,
        isExported,
        referenceCountInProject: inFileRefs,
      });
    }

    return candidates;
  }
}
