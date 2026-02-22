import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { PipelineResult } from "../../src/types.js";
import type { GraphIndex, Requirement } from "../../src/graph/types.js";

function tempDir() {
  return join(tmpdir(), `forge-graph-loop-test-${randomUUID()}`);
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

// Mock worktree manager
vi.mock("../../src/worktree/manager.js", () => ({
  createWorktree: vi.fn().mockResolvedValue(undefined),
  mergeWorktree: vi.fn().mockResolvedValue(undefined),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

// Mock linear sync
vi.mock("../../src/linear/sync.js", () => ({
  syncRequirementStart: vi.fn().mockResolvedValue(undefined),
  syncGraphProjectDone: vi.fn().mockResolvedValue(undefined),
}));

// Mock linear client
vi.mock("../../src/linear/client.js", () => ({
  ForgeLinearClient: vi.fn(),
}));

// Mock graph reader
vi.mock("../../src/graph/reader.js", () => ({
  loadGraph: vi.fn(),
  loadIndex: vi.fn(),
  loadRequirement: vi.fn(),
  loadOverview: vi.fn().mockResolvedValue("# Overview\nProject overview text."),
  loadRequirements: vi.fn().mockResolvedValue(new Map()),
}));

// Mock graph writer
vi.mock("../../src/graph/writer.js", () => ({
  updateRequirementStatus: vi.fn(),
}));

// Mock graph query
vi.mock("../../src/graph/query.js", () => ({
  findReady: vi.fn(),
  isProjectComplete: vi.fn(),
  buildRequirementContext: vi.fn().mockReturnValue([]),
  getTransitiveDeps: vi.fn().mockReturnValue([]),
}));

function makeIndex(overrides?: Partial<GraphIndex>): GraphIndex {
  return {
    project: "Test Project",
    slug: "test-graph",
    branch: "feat/test-graph",
    createdAt: new Date().toISOString(),
    groups: {
      core: { name: "Core", order: 1 },
    },
    requirements: {
      "REQ-001": {
        group: "core",
        status: "pending",
        dependsOn: [],
      },
    },
    ...overrides,
  };
}

function makeRequirement(id: string, title: string): Requirement {
  return {
    id,
    title,
    files: { creates: [], modifies: [] },
    acceptance: ["It works"],
    body: `Implement ${title}.`,
  };
}

describe("Graph loop", () => {
  const dirs: string[] = [];
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockExecFile: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let mockLoadIndex: ReturnType<typeof vi.fn>;
  let mockLoadRequirement: ReturnType<typeof vi.fn>;
  let mockUpdateRequirementStatus: ReturnType<typeof vi.fn>;
  let mockFindReady: ReturnType<typeof vi.fn>;
  let mockIsProjectComplete: ReturnType<typeof vi.fn>;
  let mockBuildRequirementContext: ReturnType<typeof vi.fn>;
  let mockGetTransitiveDeps: ReturnType<typeof vi.fn>;
  let mockLoadOverview: ReturnType<typeof vi.fn>;
  let mockLoadRequirements: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const cp = await import("node:child_process");
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;

    const reader = await import("../../src/graph/reader.js");
    mockLoadIndex = reader.loadIndex as unknown as ReturnType<typeof vi.fn>;
    mockLoadRequirement = reader.loadRequirement as unknown as ReturnType<typeof vi.fn>;

    const writer = await import("../../src/graph/writer.js");
    mockUpdateRequirementStatus = writer.updateRequirementStatus as unknown as ReturnType<typeof vi.fn>;

    const query = await import("../../src/graph/query.js");
    mockFindReady = query.findReady as unknown as ReturnType<typeof vi.fn>;
    mockIsProjectComplete = query.isProjectComplete as unknown as ReturnType<typeof vi.fn>;
    mockBuildRequirementContext = query.buildRequirementContext as unknown as ReturnType<typeof vi.fn>;
    mockBuildRequirementContext.mockReturnValue([]);
    mockGetTransitiveDeps = (query as Record<string, unknown>).getTransitiveDeps as ReturnType<typeof vi.fn>;
    mockGetTransitiveDeps.mockReturnValue([]);

    const reader2 = await import("../../src/graph/reader.js");
    mockLoadOverview = reader2.loadOverview as unknown as ReturnType<typeof vi.fn>;
    mockLoadOverview.mockResolvedValue("# Overview\nProject overview text.");
    mockLoadRequirements = reader2.loadRequirements as unknown as ReturnType<typeof vi.fn>;
    mockLoadRequirements.mockResolvedValue(new Map());

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

  const passedResult: PipelineResult = {
    result: "PASSED",
    durationMs: 100,
    gates: [{ gate: "types", passed: true, durationMs: 100, errors: [] }],
  };

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

  it("executes a ready requirement and marks it complete", async () => {
    const projectDir = setupProjectDir();
    const slug = "test-graph";

    await writeForgeConfig(projectDir, 3);

    const index = makeIndex();
    const updatedIndex = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "in_progress", dependsOn: [] },
      },
    });
    const completedIndex = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "complete", dependsOn: [], completedAt: new Date().toISOString() },
      },
    });

    // First call: initial load — not complete, has ready items
    // Second call: after completing REQ-001 — reload shows complete
    mockLoadIndex
      .mockResolvedValueOnce(index)
      .mockResolvedValueOnce(completedIndex);

    mockIsProjectComplete
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    mockFindReady.mockReturnValueOnce(["REQ-001"]);

    mockUpdateRequirementStatus
      .mockResolvedValueOnce(updatedIndex)   // in_progress
      .mockResolvedValueOnce(completedIndex); // complete

    mockLoadRequirement.mockResolvedValueOnce(makeRequirement("REQ-001", "Foundation"));

    mockSpawnSuccess();
    mockVerifyResult(passedResult);

    const { runGraphLoop } = await import("../../src/runner/loop.js");
    await runGraphLoop({ slug, projectDir });

    // Should have called updateRequirementStatus twice (in_progress + complete)
    expect(mockUpdateRequirementStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateRequirementStatus).toHaveBeenCalledWith(projectDir, slug, "REQ-001", "in_progress");
    expect(mockUpdateRequirementStatus).toHaveBeenCalledWith(projectDir, slug, "REQ-001", "complete");

    // Claude spawned once
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("exits with deadlock message when no requirements ready but project incomplete", async () => {
    const projectDir = setupProjectDir();
    const slug = "test-graph";

    await writeForgeConfig(projectDir, 3);

    const index = makeIndex();

    mockLoadIndex.mockResolvedValueOnce(index);
    mockIsProjectComplete.mockReturnValueOnce(false);
    mockFindReady.mockReturnValueOnce([]); // no ready — deadlock

    const { runGraphLoop } = await import("../../src/runner/loop.js");

    await expect(
      runGraphLoop({ slug, projectDir }),
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("completes when isProjectComplete returns true", async () => {
    const projectDir = setupProjectDir();
    const slug = "test-graph";

    await writeForgeConfig(projectDir, 3);

    const index = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "complete", dependsOn: [], completedAt: new Date().toISOString() },
      },
    });

    mockLoadIndex.mockResolvedValueOnce(index);
    mockIsProjectComplete.mockReturnValueOnce(true);

    const { runGraphLoop } = await import("../../src/runner/loop.js");
    await runGraphLoop({ slug, projectDir });

    // Should NOT spawn Claude or call findReady
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockFindReady).not.toHaveBeenCalled();
  });

  it("exits after max iterations when verify keeps failing", async () => {
    const projectDir = setupProjectDir();
    const slug = "test-graph";

    await writeForgeConfig(projectDir, 2);

    const index = makeIndex();
    const updatedIndex = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "in_progress", dependsOn: [] },
      },
    });

    mockLoadIndex.mockResolvedValueOnce(index);
    mockIsProjectComplete.mockReturnValueOnce(false);
    mockFindReady.mockReturnValueOnce(["REQ-001"]);
    mockUpdateRequirementStatus.mockResolvedValueOnce(updatedIndex);
    mockLoadRequirement.mockResolvedValueOnce(makeRequirement("REQ-001", "Foundation"));

    mockSpawnSuccess();
    mockVerifyResult(failedResult);

    const { runGraphLoop } = await import("../../src/runner/loop.js");

    await expect(
      runGraphLoop({ slug, projectDir }),
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    // Claude should have been spawned maxIterations times
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it("processes multiple requirements in ready set sequentially", async () => {
    const projectDir = setupProjectDir();
    const slug = "test-graph";

    await writeForgeConfig(projectDir, 3);

    const index = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "pending", dependsOn: [] },
        "REQ-002": { group: "core", status: "pending", dependsOn: [] },
      },
    });
    const afterFirstInProgress = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "in_progress", dependsOn: [] },
        "REQ-002": { group: "core", status: "pending", dependsOn: [] },
      },
    });
    const afterFirstComplete = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "complete", dependsOn: [], completedAt: new Date().toISOString() },
        "REQ-002": { group: "core", status: "pending", dependsOn: [] },
      },
    });
    const afterSecondInProgress = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "complete", dependsOn: [], completedAt: new Date().toISOString() },
        "REQ-002": { group: "core", status: "in_progress", dependsOn: [] },
      },
    });
    const afterSecondComplete = makeIndex({
      requirements: {
        "REQ-001": { group: "core", status: "complete", dependsOn: [], completedAt: new Date().toISOString() },
        "REQ-002": { group: "core", status: "complete", dependsOn: [], completedAt: new Date().toISOString() },
      },
    });

    // First loadIndex: initial
    // Second loadIndex: after both reqs done in for loop — reload
    mockLoadIndex
      .mockResolvedValueOnce(index)
      .mockResolvedValueOnce(afterSecondComplete);

    mockIsProjectComplete
      .mockReturnValueOnce(false)   // first while check
      .mockReturnValueOnce(true);   // second while check after reload

    mockFindReady.mockReturnValueOnce(["REQ-001", "REQ-002"]);

    mockUpdateRequirementStatus
      .mockResolvedValueOnce(afterFirstInProgress)   // REQ-001 in_progress
      .mockResolvedValueOnce(afterFirstComplete)      // REQ-001 complete
      .mockResolvedValueOnce(afterSecondInProgress)   // REQ-002 in_progress
      .mockResolvedValueOnce(afterSecondComplete);    // REQ-002 complete

    mockLoadRequirement
      .mockResolvedValueOnce(makeRequirement("REQ-001", "Foundation"))
      .mockResolvedValueOnce(makeRequirement("REQ-002", "API Layer"));

    mockSpawnSuccess();
    mockVerifyResult(passedResult);

    const { runGraphLoop } = await import("../../src/runner/loop.js");
    await runGraphLoop({ slug, projectDir });

    // Claude spawned once per requirement
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Status updated 4 times (in_progress + complete for each)
    expect(mockUpdateRequirementStatus).toHaveBeenCalledTimes(4);
    expect(mockUpdateRequirementStatus).toHaveBeenCalledWith(projectDir, slug, "REQ-001", "in_progress");
    expect(mockUpdateRequirementStatus).toHaveBeenCalledWith(projectDir, slug, "REQ-001", "complete");
    expect(mockUpdateRequirementStatus).toHaveBeenCalledWith(projectDir, slug, "REQ-002", "in_progress");
    expect(mockUpdateRequirementStatus).toHaveBeenCalledWith(projectDir, slug, "REQ-002", "complete");
  });
});
