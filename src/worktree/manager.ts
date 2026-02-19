import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function shellQuote(arg: string): string {
  if (process.platform === "win32") {
    return `"${arg}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function git(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  const cmd = ["git", ...args.map(shellQuote)].join(" ");
  return execAsync(cmd, { cwd });
}

/** Create a new worktree with a fresh branch based on baseBranch. */
export async function createWorktree(
  worktreePath: string,
  branch: string,
  baseBranch: string,
  cwd?: string,
): Promise<void> {
  await git(["worktree", "add", "-b", branch, worktreePath, baseBranch], cwd);
}

/** Merge a branch into targetBranch (fast-forward preferred). */
export async function mergeWorktree(
  branch: string,
  targetBranch: string,
  cwd?: string,
): Promise<void> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const original = stdout.trim();
  try {
    await git(["checkout", targetBranch], cwd);
    await git(["merge", "--ff-only", branch], cwd);
  } finally {
    if (original !== targetBranch) {
      await git(["checkout", original], cwd);
    }
  }
}

/** Remove a worktree and prune its reference. */
export async function removeWorktree(
  worktreePath: string,
  cwd?: string,
): Promise<void> {
  await git(["worktree", "remove", worktreePath, "--force"], cwd);
}
