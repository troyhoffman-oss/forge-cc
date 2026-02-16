import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, resolve, join } from "node:path";
import {
  generateSessionId,
  normalizePath,
  shellQuote,
} from "../utils/platform.js";
import type { Session } from "./session.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string; // commit SHA
  isMain: boolean;
}

export interface CreateWorktreeOptions {
  /** Base branch to create worktree from (default: current branch) */
  baseBranch?: string;
  /** Custom branch name. Default: forge/<user>/<slug> */
  branchName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a git command and return trimmed stdout. */
function git(args: string, cwd?: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.split(" ")[0]} failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the root directory of the current git repository.
 */
export function getRepoRoot(cwd?: string): string {
  const raw = git("rev-parse --show-toplevel", cwd);
  return normalizePath(raw);
}

/**
 * Compute the worktree base directory: ../.forge-wt/<repo-name>/
 * Uses short paths to avoid Windows 260-char limit.
 */
export function getWorktreeBaseDir(repoRoot: string): string {
  const parent = dirname(resolve(repoRoot));
  const repoName = basename(resolve(repoRoot));
  return normalizePath(parent, ".forge-wt", repoName);
}

/**
 * Create a new git worktree with an auto-generated short session ID.
 *
 * Path:   ../.forge-wt/<repo>/<8-char-id>/
 * Branch: branchName or forge/<user>/<slug>
 *
 * Returns the absolute path to the new worktree and its branch name.
 */
export function createWorktree(
  repoRoot: string,
  slug: string,
  userName: string,
  options?: CreateWorktreeOptions,
): { worktreePath: string; branch: string; sessionId: string } {
  const sessionId = generateSessionId();
  const baseDir = getWorktreeBaseDir(repoRoot);
  const worktreePath = join(baseDir, sessionId);
  // Sanitize userName for use in branch refs — git rejects spaces and
  // most special characters in branch names.
  const safeName = userName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._/-]/g, "");
  const branch = options?.branchName ?? `forge/${safeName}/${slug}`;

  // Build the git worktree add command.
  // Try creating with a new branch first (-b). If the branch already exists
  // the command will fail, so fall back to attaching to the existing branch.
  const quotedPath = shellQuote(worktreePath);
  const quotedBranch = shellQuote(branch);
  const baseBranchArg = options?.baseBranch
    ? ` ${shellQuote(options.baseBranch)}`
    : "";

  try {
    // Attempt: create new branch
    git(
      `worktree add -b ${quotedBranch} ${quotedPath}${baseBranchArg}`,
      repoRoot,
    );
  } catch {
    // Branch may already exist — try without -b
    try {
      git(
        `worktree add ${quotedPath} ${quotedBranch}`,
        repoRoot,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to create worktree at ${worktreePath} on branch ${branch}: ${message}`,
      );
    }
  }

  return { worktreePath: normalizePath(worktreePath), branch, sessionId };
}

/**
 * List all git worktrees for the repository.
 *
 * Parses the porcelain output of `git worktree list --porcelain`.
 * Each block is separated by a blank line and contains lines like:
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>
 */
export function listWorktrees(repoRoot: string): WorktreeInfo[] {
  const raw = git("worktree list --porcelain", repoRoot);

  if (!raw) return [];

  const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);
  const worktrees: WorktreeInfo[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");

    let path = "";
    let head = "";
    let branch = "";
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        // branch refs/heads/<name>  →  <name>
        const ref = line.slice("branch ".length);
        branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        isBare = true;
      } else if (line === "detached") {
        branch = "(detached)";
      }
    }

    if (path) {
      worktrees.push({
        path: normalizePath(path),
        branch,
        head,
        isMain: worktrees.length === 0 || isBare,
      });
    }
  }

  return worktrees;
}

/**
 * Remove a git worktree and clean up its directory.
 * Uses `git worktree remove --force` then prunes stale entries.
 */
export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
): void {
  const resolved = normalizePath(worktreePath);
  const quoted = shellQuote(resolved);

  try {
    git(`worktree remove --force ${quoted}`, repoRoot);
  } catch (err: unknown) {
    // If the git command fails (e.g. worktree already partially removed),
    // we still want to clean up the directory and prune.
    const message =
      err instanceof Error ? err.message : String(err);
    // Only throw if the directory still exists and we can't remove it
    if (existsSync(resolved)) {
      try {
        rmSync(resolved, { recursive: true, force: true });
      } catch (rmErr: unknown) {
        const rmMessage =
          rmErr instanceof Error ? rmErr.message : String(rmErr);
        throw new Error(
          `Failed to remove worktree at ${resolved}: git error: ${message}, cleanup error: ${rmMessage}`,
        );
      }
    }
  }

  // Clean up leftover directory if git remove succeeded but dir remains
  if (existsSync(resolved)) {
    rmSync(resolved, { recursive: true, force: true });
  }

  // Prune stale worktree entries
  try {
    git("worktree prune", repoRoot);
  } catch {
    // Non-fatal: prune is best-effort cleanup
  }
}

/**
 * Check if a worktree path exists and is valid (still tracked by git).
 */
export function isWorktreeValid(worktreePath: string): boolean {
  const resolved = normalizePath(worktreePath);

  if (!existsSync(resolved)) {
    return false;
  }

  // Determine the repo root from the worktree path itself.
  // A valid worktree has a .git file pointing back to the main repo.
  try {
    const repoRoot = getRepoRoot(resolved);
    const worktrees = listWorktrees(repoRoot);
    return worktrees.some((wt) => wt.path === resolved);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Branch deletion
// ---------------------------------------------------------------------------

const PROTECTED_BRANCHES = new Set(["main", "master"]);

/**
 * Delete a local branch by name.
 *
 * Safety: refuses to delete `main`, `master`, or the currently checked-out branch.
 *
 * By default uses `git branch -d` (safe delete) which only removes branches that
 * are fully merged into HEAD. Pass `force: true` to use `git branch -D` for
 * worktree branches that were merged via the worktree merge flow but may not
 * appear merged from HEAD's perspective.
 *
 * Non-fatal: returns boolean success, never throws.
 */
export function deleteBranch(
  repoRoot: string,
  branch: string,
  options?: { force?: boolean },
): boolean {
  if (!branch || PROTECTED_BRANCHES.has(branch)) {
    return false;
  }

  // Don't delete the currently checked-out branch
  try {
    const current = git("rev-parse --abbrev-ref HEAD", repoRoot);
    if (current === branch) {
      return false;
    }
  } catch {
    // Can't determine current branch — bail out safely
    return false;
  }

  const flag = options?.force ? "-D" : "-d";
  try {
    git(`branch ${flag} ${shellQuote(branch)}`, repoRoot);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Merged branch cleanup
// ---------------------------------------------------------------------------

export interface BranchCleanupResult {
  deleted: string[];
  errors: Array<{ branch: string; error: string }>;
}

/**
 * Find and delete local branches whose remote tracking branch is gone
 * (i.e., the PR was merged and GitHub auto-deleted the remote).
 *
 * Logic:
 * 1. `git fetch --prune` to update remote tracking state
 * 2. `git branch -vv` to list local branches with tracking status
 * 3. Find branches where tracking shows `[origin/...: gone]`
 * 4. Delete each with `deleteBranch()`
 */
export function cleanupMergedBranches(repoRoot: string): BranchCleanupResult {
  const result: BranchCleanupResult = { deleted: [], errors: [] };

  // Prune remote tracking refs
  try {
    git("fetch --prune", repoRoot);
  } catch {
    // Non-fatal: proceed with current state
  }

  // List branches with tracking info
  let branchOutput: string;
  try {
    branchOutput = git("branch -vv", repoRoot);
  } catch {
    return result;
  }

  if (!branchOutput) return result;

  // Parse lines like:
  //   feat/auth        abc1234 [origin/feat/auth: gone] commit message
  //   * main           def5678 [origin/main] commit message
  const gonePattern = /^\s*\*?\s*(\S+)\s+\S+\s+\[.+:\s*gone\]/;

  for (const line of branchOutput.split("\n")) {
    const match = line.match(gonePattern);
    if (!match) continue;

    const branch = match[1];
    const deleted = deleteBranch(repoRoot, branch);
    if (deleted) {
      result.deleted.push(branch);
    } else if (!PROTECTED_BRANCHES.has(branch)) {
      result.errors.push({ branch, error: "delete failed" });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export interface CleanupResult {
  removed: Array<{ sessionId: string; worktreePath: string; branch: string }>;
  errors: Array<{ sessionId: string; error: string }>;
}

/**
 * Remove worktrees associated with stale sessions.
 * Idempotent — if a worktree is already gone, it counts as success.
 */
export function cleanupStaleWorktrees(
  repoRoot: string,
  staleSessions: Session[],
): CleanupResult {
  const result: CleanupResult = { removed: [], errors: [] };

  for (const session of staleSessions) {
    try {
      // If the worktree directory still exists, remove it via git
      if (existsSync(session.worktreePath)) {
        removeWorktree(repoRoot, session.worktreePath);
      }
      // Delete the worktree branch — force-delete since it was merged via worktree flow
      deleteBranch(repoRoot, session.branch, { force: true });
      // Whether it existed or not, record as successfully removed
      result.removed.push({
        sessionId: session.id,
        worktreePath: session.worktreePath,
        branch: session.branch,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ sessionId: session.id, error: message });
    }
  }

  return result;
}
