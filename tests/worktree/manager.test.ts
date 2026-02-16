import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, join, dirname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("../../src/utils/platform.js", () => ({
  generateSessionId: vi.fn(() => "abcd1234"),
  normalizePath: (...segments: string[]) => resolve(join(...segments)),
  shellQuote: (value: string) => {
    if (process.platform === "win32") {
      const escaped = value.replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    const escaped = value.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  },
}));

import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import {
  getRepoRoot,
  getWorktreeBaseDir,
  createWorktree,
  listWorktrees,
  removeWorktree,
  isWorktreeValid,
} from "../../src/worktree/manager.js";
import { generateSessionId } from "../../src/utils/platform.js";

const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedRmSync = vi.mocked(rmSync);
const mockedGenerateSessionId = vi.mocked(generateSessionId);

beforeEach(() => {
  vi.resetAllMocks();
  mockedGenerateSessionId.mockReturnValue("abcd1234");
});

// ---------------------------------------------------------------------------
// getRepoRoot
// ---------------------------------------------------------------------------

describe("getRepoRoot", () => {
  it("returns normalized path from git rev-parse", () => {
    mockedExecSync.mockReturnValue("/home/user/my-repo\n");
    const result = getRepoRoot();
    expect(result).toBe(resolve("/home/user/my-repo"));
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git rev-parse --show-toplevel",
      expect.objectContaining({ encoding: "utf-8", stdio: "pipe" }),
    );
  });

  it("passes cwd to execSync when provided", () => {
    mockedExecSync.mockReturnValue("/some/path\n");
    getRepoRoot("/custom/dir");
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git rev-parse --show-toplevel",
      expect.objectContaining({ cwd: "/custom/dir" }),
    );
  });

  it("throws a descriptive error when git fails", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });
    expect(() => getRepoRoot()).toThrow("git rev-parse failed");
  });
});

// ---------------------------------------------------------------------------
// getWorktreeBaseDir
// ---------------------------------------------------------------------------

describe("getWorktreeBaseDir", () => {
  it("computes base dir as parent/.forge-wt/repoName", () => {
    const repoRoot = resolve("/projects/my-app");
    const result = getWorktreeBaseDir(repoRoot);
    const expected = resolve(
      dirname(resolve(repoRoot)),
      ".forge-wt",
      basename(resolve(repoRoot)),
    );
    expect(result).toBe(expected);
  });

  it("handles repo root with trailing separator", () => {
    const repoRoot = resolve("/projects/my-app/");
    const result = getWorktreeBaseDir(repoRoot);
    // resolve normalizes trailing separators
    const expectedParent = dirname(resolve(repoRoot));
    const expectedName = basename(resolve(repoRoot));
    const expected = resolve(expectedParent, ".forge-wt", expectedName);
    expect(result).toBe(expected);
  });

  it("handles nested repo directories", () => {
    const repoRoot = resolve("/deep/nested/path/repo");
    const result = getWorktreeBaseDir(repoRoot);
    const expected = resolve("/deep/nested/path", ".forge-wt", "repo");
    expect(result).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// createWorktree
// ---------------------------------------------------------------------------

describe("createWorktree", () => {
  const repoRoot = resolve("/projects/my-app");

  it("creates worktree with default branch naming", () => {
    mockedExecSync.mockReturnValue("");
    const result = createWorktree(repoRoot, "add-login", "troy");

    expect(result.sessionId).toBe("abcd1234");
    expect(result.branch).toBe("forge/troy/add-login");
    expect(result.worktreePath).toBe(
      resolve(getWorktreeBaseDir(repoRoot), "abcd1234"),
    );
  });

  it("uses custom branch name from options", () => {
    mockedExecSync.mockReturnValue("");
    const result = createWorktree(repoRoot, "fix", "troy", {
      branchName: "custom/branch",
    });
    expect(result.branch).toBe("custom/branch");
  });

  it("falls back to existing branch when -b fails", () => {
    let callCount = 0;
    mockedExecSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: git worktree add -b fails (branch exists)
        throw new Error("branch already exists");
      }
      // Second call: git worktree add without -b succeeds
      return "";
    });

    const result = createWorktree(repoRoot, "existing-feature", "troy");
    expect(result.branch).toBe("forge/troy/existing-feature");
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
  });

  it("throws when both worktree add attempts fail", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("worktree error");
    });

    expect(() => createWorktree(repoRoot, "bad", "troy")).toThrow(
      "Failed to create worktree",
    );
  });

  it("includes baseBranch in git command when provided", () => {
    mockedExecSync.mockReturnValue("");
    createWorktree(repoRoot, "feature", "troy", { baseBranch: "develop" });

    const firstCall = mockedExecSync.mock.calls[0][0] as string;
    expect(firstCall).toContain("develop");
  });
});

// ---------------------------------------------------------------------------
// listWorktrees
// ---------------------------------------------------------------------------

describe("listWorktrees", () => {
  const repoRoot = resolve("/projects/my-app");

  it("returns empty array for empty output", () => {
    mockedExecSync.mockReturnValue("");
    const result = listWorktrees(repoRoot);
    expect(result).toEqual([]);
  });

  it("parses single worktree (main)", () => {
    mockedExecSync.mockReturnValue(
      [
        "worktree /projects/my-app",
        "HEAD abc123def456",
        "branch refs/heads/main",
        "",
      ].join("\n"),
    );

    const result = listWorktrees(repoRoot);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(resolve("/projects/my-app"));
    expect(result[0].branch).toBe("main");
    expect(result[0].head).toBe("abc123def456");
    expect(result[0].isMain).toBe(true);
  });

  it("parses multiple worktrees, marks first as main", () => {
    mockedExecSync.mockReturnValue(
      [
        "worktree /projects/my-app",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /projects/.forge-wt/my-app/session1",
        "HEAD def456",
        "branch refs/heads/forge/troy/feature",
        "",
      ].join("\n"),
    );

    const result = listWorktrees(repoRoot);
    expect(result).toHaveLength(2);
    expect(result[0].isMain).toBe(true);
    expect(result[1].isMain).toBe(false);
    expect(result[1].branch).toBe("forge/troy/feature");
  });

  it("handles detached HEAD worktrees", () => {
    mockedExecSync.mockReturnValue(
      [
        "worktree /projects/my-app",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /projects/.forge-wt/my-app/session2",
        "HEAD def456",
        "detached",
        "",
      ].join("\n"),
    );

    const result = listWorktrees(repoRoot);
    expect(result).toHaveLength(2);
    expect(result[1].branch).toBe("(detached)");
  });

  it("handles bare worktrees", () => {
    mockedExecSync.mockReturnValue(
      [
        "worktree /projects/my-app",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /projects/.forge-wt/my-app/bare-wt",
        "HEAD def456",
        "branch refs/heads/some-branch",
        "bare",
        "",
      ].join("\n"),
    );

    const result = listWorktrees(repoRoot);
    expect(result).toHaveLength(2);
    expect(result[1].isMain).toBe(true); // bare worktrees are marked isMain
  });

  it("strips refs/heads/ prefix from branch names", () => {
    mockedExecSync.mockReturnValue(
      [
        "worktree /projects/my-app",
        "HEAD abc123",
        "branch refs/heads/feature/deep/path",
        "",
      ].join("\n"),
    );

    const result = listWorktrees(repoRoot);
    expect(result[0].branch).toBe("feature/deep/path");
  });
});

// ---------------------------------------------------------------------------
// removeWorktree
// ---------------------------------------------------------------------------

describe("removeWorktree", () => {
  const repoRoot = resolve("/projects/my-app");
  const worktreePath = resolve("/projects/.forge-wt/my-app/abcd1234");

  it("calls git worktree remove --force and prunes", () => {
    mockedExecSync.mockReturnValue("");
    mockedExistsSync.mockReturnValue(false);

    removeWorktree(repoRoot, worktreePath);

    const calls = mockedExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("worktree remove --force"))).toBe(true);
    expect(calls.some((c) => c.includes("worktree prune"))).toBe(true);
  });

  it("falls back to rmSync when git remove fails and dir exists", () => {
    let callCount = 0;
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("worktree remove")) {
        throw new Error("remove failed");
      }
      // prune succeeds
      return "";
    });
    // existsSync: first call (after git remove fails) returns true,
    // second call (after rmSync cleanup) returns false
    mockedExistsSync
      .mockReturnValueOnce(true)   // inside catch: existsSync(resolved) -> true
      .mockReturnValueOnce(false); // after catch: existsSync(resolved) -> false

    removeWorktree(repoRoot, worktreePath);

    expect(mockedRmSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true, force: true },
    );
  });

  it("throws when git remove fails and rmSync also fails", () => {
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("worktree remove")) {
        throw new Error("git remove failed");
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(true);
    mockedRmSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    expect(() => removeWorktree(repoRoot, worktreePath)).toThrow(
      "Failed to remove worktree",
    );
  });

  it("cleans up leftover directory after successful git remove", () => {
    mockedExecSync.mockReturnValue("");
    // existsSync returns true after git remove: directory still exists
    mockedExistsSync.mockReturnValue(true);

    removeWorktree(repoRoot, worktreePath);

    expect(mockedRmSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true, force: true },
    );
  });

  it("tolerates prune failure silently", () => {
    let callCount = 0;
    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("worktree prune")) {
        throw new Error("prune failed");
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    // Should not throw
    expect(() => removeWorktree(repoRoot, worktreePath)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isWorktreeValid
// ---------------------------------------------------------------------------

describe("isWorktreeValid", () => {
  const worktreePath = resolve("/projects/.forge-wt/my-app/abcd1234");

  it("returns false when directory does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    expect(isWorktreeValid(worktreePath)).toBe(false);
  });

  it("returns true when path exists and appears in worktree list", () => {
    mockedExistsSync.mockReturnValue(true);

    // First execSync: getRepoRoot -> git rev-parse --show-toplevel
    // Second execSync: listWorktrees -> git worktree list --porcelain
    let callCount = 0;
    mockedExecSync.mockImplementation((cmd) => {
      callCount++;
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("rev-parse")) {
        return "/projects/my-app\n";
      }
      if (cmdStr.includes("worktree list")) {
        return [
          `worktree /projects/my-app`,
          "HEAD abc123",
          "branch refs/heads/main",
          "",
          `worktree ${worktreePath}`,
          "HEAD def456",
          "branch refs/heads/forge/troy/feature",
          "",
        ].join("\n");
      }
      return "";
    });

    expect(isWorktreeValid(worktreePath)).toBe(true);
  });

  it("returns false when path exists but not in worktree list", () => {
    mockedExistsSync.mockReturnValue(true);

    mockedExecSync.mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("rev-parse")) {
        return "/projects/my-app\n";
      }
      if (cmdStr.includes("worktree list")) {
        return [
          "worktree /projects/my-app",
          "HEAD abc123",
          "branch refs/heads/main",
          "",
        ].join("\n");
      }
      return "";
    });

    expect(isWorktreeValid(worktreePath)).toBe(false);
  });

  it("returns false when getRepoRoot throws", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    expect(isWorktreeValid(worktreePath)).toBe(false);
  });
});
