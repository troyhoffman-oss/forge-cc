import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { PipelineResult, PRDStatus } from "../../src/types.js";

function tempDir() {
  return join(tmpdir(), `forge-loop-test-${randomUUID()}`);
}

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => {
  const actualSpawn = vi.fn();
  const actualExecFile = vi.fn();
  return {
    spawn: actualSpawn,
    execFile: actualExecFile,
  };
});

// Mock worktree manager — we don't want real git operations in unit tests
vi.mock("../../src/worktree/manager.js", () => ({
  createWorktree: vi.fn().mockResolvedValue(undefined),
  mergeWorktree: vi.fn().mockResolvedValue(undefined),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

// Mock linear sync
vi.mock("../../src/linear/sync.js", () => ({
  syncMilestoneStart: vi.fn().mockResolvedValue(undefined),
  syncMilestoneComplete: vi.fn().mockResolvedValue(undefined),
}));

// Mock linear client
vi.mock("../../src/linear/client.js", () => ({
  ForgeLinearClient: vi.fn(),
}));

describe("Ralph loop", () => {
  const dirs: string[] = [];
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockExecFile: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const cp = await import("node:child_process");
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;

    // Prevent process.exit from actually exiting
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function setupProjectDir() {
    const dir = tempDir();
    dirs.push(dir);
    return dir;
  }

  async function writeStatusFile(projectDir: string, slug: string, status: PRDStatus) {
    const statusDir = join(projectDir, ".planning", "status");
    await mkdir(statusDir, { recursive: true });
    await writeFile(join(statusDir, `${slug}.json`), JSON.stringify(status, null, 2), "utf-8");
  }

  async function writePRDFile(projectDir: string, slug: string, content: string) {
    const prdDir = join(projectDir, ".planning", "prds");
    await mkdir(prdDir, { recursive: true });
    await writeFile(join(prdDir, `${slug}.md`), content, "utf-8");
  }

  async function writeForgeConfig(projectDir: string, maxIterations: number) {
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, ".forge.json"),
      JSON.stringify({ maxIterations, gates: ["types"] }, null, 2),
      "utf-8",
    );
  }

  function mockSpawnSuccess() {
    mockSpawn.mockImplementation(() => {
      const EventEmitter = require("node:events");
      const { PassThrough } = require("node:stream");
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      // Simulate Claude exiting immediately
      setTimeout(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0);
      }, 10);
      return child;
    });
  }

  function mockVerifyResult(result: PipelineResult) {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (callback) {
          callback(null, { stdout: JSON.stringify(result), stderr: "" });
        }
      },
    );
  }

  it("exits after max iterations when verify keeps failing", async () => {
    const projectDir = setupProjectDir();
    const slug = "test-project";

    await writeForgeConfig(projectDir, 2);
    await writeStatusFile(projectDir, slug, {
      project: "Test Project",
      slug,
      branch: "feat/test-project",
      createdAt: new Date().toISOString(),
      milestones: {
        "1: Foundation": { status: "pending" },
      },
    });
    await writePRDFile(
      projectDir,
      slug,
      "# Test PRD\n\n### Milestone 1: Foundation\nSet up the project.\n",
    );

    mockSpawnSuccess();

    const failedResult: PipelineResult = {
      result: "FAILED",
      durationMs: 100,
      gates: [
        {
          gate: "types",
          passed: false,
          durationMs: 100,
          errors: [{ file: "src/foo.ts", line: 1, message: "Type error" }],
        },
      ],
    };
    mockVerifyResult(failedResult);

    const { runRalphLoop } = await import("../../src/runner/loop.js");

    await expect(
      runRalphLoop({ slug, projectDir }),
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    // Should have spawned Claude exactly maxIterations times
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("advances to next milestone on verify pass", async () => {
    const projectDir = setupProjectDir();
    const slug = "test-project";

    await writeForgeConfig(projectDir, 3);
    await writeStatusFile(projectDir, slug, {
      project: "Test Project",
      slug,
      branch: "feat/test-project",
      createdAt: new Date().toISOString(),
      milestones: {
        "1: Foundation": { status: "pending" },
        "2: Features": { status: "pending" },
      },
    });
    await writePRDFile(
      projectDir,
      slug,
      [
        "# Test PRD",
        "",
        "### Milestone 1: Foundation",
        "Set up the project.",
        "",
        "### Milestone 2: Features",
        "Build features.",
      ].join("\n"),
    );

    mockSpawnSuccess();

    const passedResult: PipelineResult = {
      result: "PASSED",
      durationMs: 100,
      gates: [{ gate: "types", passed: true, durationMs: 100, errors: [] }],
    };
    mockVerifyResult(passedResult);

    const { runRalphLoop } = await import("../../src/runner/loop.js");
    await runRalphLoop({ slug, projectDir });

    // Should have spawned Claude twice (once per milestone)
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Verify status file was updated
    const { readStatus } = await import("../../src/state/status.js");
    const updatedStatus = await readStatus(projectDir, slug);
    expect(updatedStatus.milestones["1: Foundation"].status).toBe("complete");
    expect(updatedStatus.milestones["2: Features"].status).toBe("complete");
  });
});
