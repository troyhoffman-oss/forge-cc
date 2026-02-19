import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  createWorktree,
  mergeWorktree,
  removeWorktree,
} from "../../src/worktree/manager.js";

const execAsync = promisify(exec);

function shellQuote(arg: string): string {
  if (process.platform === "win32") {
    return `"${arg}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function git(args: string[], cwd: string) {
  const cmd = ["git", ...args.map(shellQuote)].join(" ");
  return execAsync(cmd, { cwd });
}

function tempDir() {
  return join(tmpdir(), `forge-wt-test-${randomUUID()}`);
}

describe("worktree manager", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("worktree create/merge/remove lifecycle works", async () => {
    // 1. Set up a real git repo with an initial commit
    const repoDir = tempDir();
    dirs.push(repoDir);
    await mkdir(repoDir, { recursive: true });
    await git(["init", "-b", "main"], repoDir);
    await git(["config", "user.email", "test@test.com"], repoDir);
    await git(["config", "user.name", "Test"], repoDir);

    const readmePath = join(repoDir, "README.md");
    await writeFile(readmePath, "# Main\n", "utf-8");
    await git(["add", "."], repoDir);
    await git(["commit", "-m", "initial"], repoDir);

    // 2. Create a worktree with a milestone branch
    const wtPath = join(tempDir(), "m1");
    dirs.push(join(wtPath, ".."));
    await createWorktree(wtPath, "feat/project-x/m1", "main", repoDir);

    // 3. Make a commit in the worktree
    const wtFile = join(wtPath, "milestone.txt");
    await writeFile(wtFile, "milestone 1 work\n", "utf-8");
    await git(["add", "."], wtPath);
    await git(["commit", "-m", "milestone 1"], wtPath);

    // 4. Merge the worktree branch back into main
    await mergeWorktree("feat/project-x/m1", "main", repoDir);

    // Verify the merge landed on main
    await git(["checkout", "main"], repoDir);
    const merged = await readFile(join(repoDir, "milestone.txt"), "utf-8");
    expect(merged.trim()).toBe("milestone 1 work");

    // 5. Remove the worktree
    await removeWorktree(wtPath, repoDir);

    // Verify the worktree is gone
    const { stdout } = await git(["worktree", "list", "--porcelain"], repoDir);
    expect(stdout).not.toContain("feat/project-x/m1");
  });
});
