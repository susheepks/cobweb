import * as path from 'path';
import { minimatch } from 'minimatch';
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
   * Always false for entry-point files (matched by entryPointGlobs).
   */
  isOrphanFile: boolean;
  /**
   * True when the file matched one of the entryPointGlobs patterns.
   * Entry-point files (extension.ts, index.ts, main.ts …) are invoked by the
   * host or framework by convention — their exported functions will legitimately
   * have zero internal callers, so flagging them as orphans would be a false positive.
   */
  isEntryPointFile: boolean;
  /** The names of functions that still have callers (useful for partial-orphan reporting). */
  functionsWithCallers: string[];
}

/**
 * Returns true if the given absolute file path matches any of the provided
 * glob patterns.  Matching is done against the basename AND the full
 * normalised path so that patterns like "** /extension.ts" work correctly.
 */
export function isEntryPoint(filePath: string, entryPointGlobs: string[]): boolean {
  // normalise to forward-slashes so minimatch works on Windows paths too
  const normalised = filePath.replace(/\\/g, '/');
  const basename = path.basename(filePath);
  return entryPointGlobs.some(
    glob => minimatch(normalised, glob, { dot: true }) || minimatch(basename, glob.replace(/^\*\*\//, ''), { dot: true })
  );
}

/**
 * Determines whether a given file is a "whole-file orphan" — every exported
 * function has zero project-wide internal callers.  This is a stronger signal
 * than a single zero-ref function: it suggests the entire module may be
 * unused and safe to delete as a unit.
 *
 * Entry-point files matched by entryPointGlobs are never flagged — their
 * exports are called by the host process (VS Code, Node, a bundler) by
 * convention, not by import statements that static analysis can see.
 *
 * The class is stateless — it operates on plain SymbolCandidate objects so it
 * can be unit-tested without the VS Code host or a live ts-morph Project.
 */
export class OrphanAnalyzer {
  /**
   * @param candidates      All candidates found in a SINGLE file (not the whole project).
   * @param filePath        Absolute path of the file being analysed.
   * @param entryPointGlobs Glob patterns for entry-point files that must never be flagged.
   *                        Defaults to the standard list if omitted (useful for tests).
   */
  analyzeFile(
    candidates: SymbolCandidate[],
    filePath: string,
    entryPointGlobs: string[] = ['**/extension.ts', '**/index.ts', '**/main.ts', '**/server.ts', '**/app.ts']
  ): FileOrphanResult {
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
    const isEntryPointFile = isEntryPoint(filePath, entryPointGlobs);

    // "Orphan file" = has at least one exported function, no function has a
    // known caller, the file is not empty, AND it is not a known entry point.
    const isOrphanFile =
      total > 0 &&
      hasAnyExported &&
      calledRef === 0 &&
      !isEntryPointFile;

    return {
      filePath,
      total,
      zeroRef,
      unknownRef,
      calledRef,
      isOrphanFile,
      isEntryPointFile,
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

