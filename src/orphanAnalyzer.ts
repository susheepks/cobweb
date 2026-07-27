import { SymbolCandidate } from './staticAnalyzer';

export interface FileOrphanResult {
  /** Absolute path of the analysed file. */
  filePath: string;
  /** All functions found in the file. */
  total: number;
  /** Functions with referenceCountInProject === 0 (excluding -1 / unknown). */
  zeroRef: number;
  /** Functions with referenceCountInProject === -1 (ref count could not be determined). */
  unknownRef: number;
  /** Functions that ARE called at least once within the project. */
  calledRef: number;
  /**
   * True when EVERY function in the file either has zero refs or unknown refs
   * AND at least one function is exported.
   * A file with no exported functions cannot be a meaningful "orphan" candidate
   * — it could be a side-effect module or a utility barrel re-exporting from elsewhere.
   */
  isOrphanFile: boolean;
  /** The names of functions that still have callers (useful for partial-orphan reporting). */
  functionsWithCallers: string[];
}

/**
 * Determines whether a given file is a "whole-file orphan" — every exported
 * function has zero project-wide internal callers.  This is a stronger signal
 * than a single zero-ref function: it suggests the entire module may be
 * unused and safe to delete as a unit.
 *
 * The class is stateless and dependency-free — it operates on plain
 * SymbolCandidate objects so it can be unit-tested without the VS Code host
 * or a live ts-morph Project.
 */
export class OrphanAnalyzer {
  /**
   * @param candidates All candidates found in a SINGLE file (not the whole project).
   * @param filePath   Absolute path of the file being analysed.
   */
  analyzeFile(candidates: SymbolCandidate[], filePath: string): FileOrphanResult {
    const total = candidates.length;
    let zeroRef = 0;
    let unknownRef = 0;
    let calledRef = 0;
    const functionsWithCallers: string[] = [];

    for (const c of candidates) {
      if (c.referenceCountInProject === -1) {
        unknownRef++;
      } else if (c.referenceCountInProject === 0) {
        zeroRef++;
      } else {
        calledRef++;
        functionsWithCallers.push(c.name);
      }
    }

    const hasAnyExported = candidates.some(c => c.isExported);

    // "Orphan file" = has at least one exported function, no function has a
    // known caller, and the file is not empty.
    const isOrphanFile =
      total > 0 &&
      hasAnyExported &&
      calledRef === 0;

    return {
      filePath,
      total,
      zeroRef,
      unknownRef,
      calledRef,
      isOrphanFile,
      functionsWithCallers,
    };
  }

  /**
   * Convenience: given results from the whole project, return only the files
   * that qualify as orphan files, sorted by total function count descending
   * (biggest "wins" first).
   */
  filterOrphanFiles(results: FileOrphanResult[]): FileOrphanResult[] {
    return results
      .filter(r => r.isOrphanFile)
      .sort((a, b) => b.total - a.total);
  }
}
