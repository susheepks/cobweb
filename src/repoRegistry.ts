import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';

interface RepoHandle {
  git: SimpleGit;
  root: string;
  isShallow: boolean;
  usable: boolean;
}

/**
 * PRODUCTION FIX vs v0.1: the original GitAnalyzer bound itself to
 * workspace.workspaceFolders[0] once at startup. That breaks for:
 *  - multi-root workspaces (folder A and folder B are different repos)
 *  - monorepos with nested git repos or submodules
 *  - a workspace folder that ISN'T the repo root (opened a subdirectory)
 *
 * This registry resolves the correct repo root per-file by walking up
 * the directory tree looking for `.git`, and caches the result per root
 * so repeated lookups for files in the same repo are free.
 */
export class RepoRegistry {
  private handles = new Map<string, RepoHandle>(); // keyed by resolved root path
  private rootForDir = new Map<string, string | null>(); // dir -> resolved root, memoized

  async getRepoForFile(absoluteFilePath: string): Promise<RepoHandle | null> {
    const dir = path.dirname(absoluteFilePath);
    const root = await this.resolveRoot(dir);
    if (!root) return null;

    const existing = this.handles.get(root);
    if (existing) return existing;

    const handle = await this.buildHandle(root);
    this.handles.set(root, handle);
    return handle;
  }

  /** Invalidate cached handles — used when the user manually refreshes, in case
   *  a repo was initialized, a submodule added, etc. mid-session. */
  invalidateAll(): void {
    this.handles.clear();
    this.rootForDir.clear();
  }

  private async resolveRoot(dir: string): Promise<string | null> {
    if (this.rootForDir.has(dir)) return this.rootForDir.get(dir)!;

    let current = dir;
    const visited: string[] = [];
    // Walk up at most 40 levels — defensive bound against filesystem oddities
    // (symlink loops, network mounts) rather than looping forever.
    for (let i = 0; i < 40; i++) {
      visited.push(current);
      if (fs.existsSync(path.join(current, '.git'))) {
        for (const d of visited) this.rootForDir.set(d, current);
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break; // reached filesystem root
      current = parent;
    }
    for (const d of visited) this.rootForDir.set(d, null);
    return null;
  }

  private async buildHandle(root: string): Promise<RepoHandle> {
    try {
      const git = simpleGit(root);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return { git, root, isShallow: false, usable: false };
      }
      const shallowFlag = await git.revparse(['--is-shallow-repository']).catch(() => 'false');
      return { git, root, isShallow: shallowFlag.trim() === 'true', usable: true };
    } catch {
      // git binary missing, permission denied, corrupted .git dir, etc.
      return { git: simpleGit(root), root, isShallow: false, usable: false };
    }
  }
}
