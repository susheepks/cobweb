import * as path from 'path';
import * as fs from 'fs';
import { LRUCache } from 'lru-cache';
import pLimit from 'p-limit';
import type { SimpleGit } from 'simple-git';
import { RepoRegistry } from './repoRegistry';

export interface GitSymbolHistory {
  lastModifiedISO: string | null;
  daysSinceLastModified: number | null;
  lastAuthor: string | null;
  commitCountTouchingSymbol: number;
  fileTrackedByGit: boolean;
  repoUsable: boolean;
  isShallowRepo: boolean;
}

const EMPTY_HISTORY: GitSymbolHistory = {
  lastModifiedISO: null,
  daysSinceLastModified: null,
  lastAuthor: null,
  commitCountTouchingSymbol: 0,
  fileTrackedByGit: false,
  repoUsable: false,
  isShallowRepo: false,
};

/**
 * PRODUCTION FIXES vs v0.1:
 *
 * 1. CACHING — the original called `git log -S` fresh every time a CodeLens
 *    was requested. VS Code calls provideCodeLenses on scroll, focus change,
 *    and save — without caching, a file with 30 zero-ref candidates would
 *    spawn 30 git subprocesses on every single trigger. Now results are
 *    cached per (file, symbol, file-mtime) key, so unchanged files are free
 *    after the first pass.
 *
 * 2. CONCURRENCY LIMIT — spawning unlimited concurrent `git log` child
 *    processes on a file with many candidates (or many files opening at once
 *    during a workspace-wide refresh) can exhaust process/file-descriptor
 *    limits on some systems, especially CI containers and low-resource
 *    machines. Capped at 4 concurrent git processes via p-limit.
 *
 * 3. MULTI-ROOT / NESTED REPOS — delegated to RepoRegistry, which resolves
 *    the correct repo root per file instead of assuming a single workspace-
 *    wide repo.
 */
export class GitAnalyzer {
  private registry = new RepoRegistry();
  private cache = new LRUCache<string, GitSymbolHistory>({ max: 5000 });
  private limit = pLimit(4);

  invalidateCache(): void {
    this.cache.clear();
    this.registry.invalidateAll();
  }

  async getSymbolHistory(absoluteFilePath: string, symbolName: string): Promise<GitSymbolHistory> {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(absoluteFilePath).mtimeMs;
    } catch {
      return EMPTY_HISTORY;
    }

    const cacheKey = `${absoluteFilePath}::${symbolName}::${mtimeMs}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const result = await this.limit(() => this.computeSymbolHistory(absoluteFilePath, symbolName));
    this.cache.set(cacheKey, result);
    return result;
  }

  private async computeSymbolHistory(
    absoluteFilePath: string,
    symbolName: string
  ): Promise<GitSymbolHistory> {
    const repo = await this.registry.getRepoForFile(absoluteFilePath);
    if (!repo || !repo.usable) {
      return { ...EMPTY_HISTORY, repoUsable: false };
    }

    const relPath = path.relative(repo.root, absoluteFilePath);
    if (relPath.startsWith('..')) {
      return { ...EMPTY_HISTORY, repoUsable: true, isShallowRepo: repo.isShallow };
    }

    try {
      const tracked = await repo.git.raw(['ls-files', '--error-unmatch', relPath]).catch(() => null);
      if (!tracked) {
        return { ...EMPTY_HISTORY, repoUsable: true, isShallowRepo: repo.isShallow, fileTrackedByGit: false };
      }

      // IMPORTANT: simple-git's object-options form for `.log()` renders `-S`
      // as `-S=<value>`, which git silently treats as a non-matching pickaxe
      // string (verified manually: `-S=foo` finds nothing, `-Sfoo` finds the
      // real history). The pickaxe flag requires no separator between -S and
      // the search string, so raw argv is built directly instead of relying
      // on the options-object mapping.
      //
      // BUGFIX: only the single most recent commit is needed for the
      // "last touched / last author" display, so this now asks for `-n 1`
      // instead of `-n 5`. The previous `-n 5` silently capped
      // commitCountTouchingSymbol at 5 for any symbol with a longer history,
      // making that field quietly wrong rather than merely incomplete. The
      // true count is now fetched separately (see below) without a limit.
      const log = await repo.git.log([
        '--follow',
        `-S${symbolName}`,
        '-n', '1',
        '--',
        relPath,
      ]);

      if (!log.all || log.all.length === 0) {
        return {
          ...EMPTY_HISTORY,
          repoUsable: true,
          isShallowRepo: repo.isShallow,
          fileTrackedByGit: true,
        };
      }

      const mostRecent = log.all[0];
      const days = Math.floor(
        (Date.now() - new Date(mostRecent.date).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Cheap, unbounded count of commits touching this symbol — `--oneline`
      // keeps the output small even on symbols with hundreds of touches.
      const commitCountTouchingSymbol = await this.countSymbolCommits(repo.git, symbolName, relPath);

      return {
        lastModifiedISO: mostRecent.date,
        daysSinceLastModified: days,
        lastAuthor: mostRecent.author_name || null,
        commitCountTouchingSymbol,
        fileTrackedByGit: true,
        repoUsable: true,
        isShallowRepo: repo.isShallow,
      };
    } catch {
      return { ...EMPTY_HISTORY, repoUsable: true, isShallowRepo: repo.isShallow, fileTrackedByGit: true };
    }
  }

  /** Counts every commit touching `symbolName` in `relPath`, with no `-n`
   *  limit. `--oneline` keeps each line to a single short hash + subject so
   *  this stays cheap even on symbols with a long edit history. Falls back
   *  to 1 (we already know at least one commit exists, from the caller) if
   *  the count query itself fails for any reason. */
  private async countSymbolCommits(git: SimpleGit, symbolName: string, relPath: string): Promise<number> {
    try {
      const output = await git.raw(['log', '--follow', '--oneline', `-S${symbolName}`, '--', relPath]);
      const lineCount = output.split('\n').filter((line) => line.trim().length > 0).length;
      return lineCount > 0 ? lineCount : 1;
    } catch {
      return 1;
    }
  }
}
