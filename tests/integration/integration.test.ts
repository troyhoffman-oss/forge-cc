import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ForgeConfig, GateResult, PipelineResult, PRDStatus } from "../../src/types.js";
import type { ForgeLinearClient } from "../../src/linear/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return join(tmpdir(), `forge-integration-${randomUUID()}`);
}

function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    gates: ["types", "lint", "tests"],
    gateTimeouts: {},
    maxIterations: 5,
    linearTeam: "TEAM-1",
    verifyFreshness: 600000,
    forgeVersion: "1.0.0",
    ...overrides,
  };
}

function makeStatus(overrides: Partial<PRDStatus> = {}): PRDStatus {
  return {
    project: "Test Project",
    slug: "test-project",
    branch: "feat/test-project",
    createdAt: new Date().toISOString(),
    linearProjectId: "proj-1",
    linearTeamId: "team-1",
    milestones: {
      "1: Foundation": {
        status: "pending",
        linearIssueIds: ["issue-1", "issue-2"],
      },
      "2: Features": {
        status: "pending",
        linearIssueIds: ["issue-3"],
      },
    },
    ...overrides,
  };
}

function mockLinearClient(): ForgeLinearClient {
  return {
    resolveIssueStateByCategory: vi.fn().mockImplementation((_teamId: string, category: string) => {
      const categoryMap: Record<string, string> = {
        started: "state-started-uuid",
        completed: "state-completed-uuid",
        unstarted: "state-unstarted-uuid",
      };
      return Promise.resolve(categoryMap[category] ?? `state-${category}-uuid`);
    }),
    resolveProjectStatusByCategory: vi.fn().mockImplementation((category: string) => {
      const categoryMap: Record<string, string> = {
        planned: "pstatus-planned-uuid",
        started: "pstatus-started-uuid",
        completed: "pstatus-completed-uuid",
      };
      return Promise.resolve(categoryMap[category] ?? `pstatus-${category}-uuid`);
    }),
    updateIssueState: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    updateIssueBatch: vi.fn().mockResolvedValue({ success: true, data: { updated: 2, failed: [] } }),
    updateProjectState: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    listTeams: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    listIssuesByProject: vi.fn().mockResolvedValue([]),
  } as unknown as ForgeLinearClient;
}

// ---------------------------------------------------------------------------
// TEST 1: verify → status → linear-sync end-to-end pipeline
// ---------------------------------------------------------------------------

describe("Integration: verify → status → linear-sync pipeline", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function setupDir() {
    const dir = tempDir();
    dirs.push(dir);
    return dir;
  }

  async function writeStatusFile(projectDir: string, slug: string, status: PRDStatus) {
    const statusDir = join(projectDir, ".planning", "status");
    await mkdir(statusDir, { recursive: true });
    await writeFile(join(statusDir, `${slug}.json`), JSON.stringify(status, null, 2), "utf-8");
  }

  async function writeForgeConfig(projectDir: string, config: Partial<ForgeConfig> = {}) {
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, ".forge.json"),
      JSON.stringify({ gates: ["fake"], ...config }, null, 2),
      "utf-8",
    );
  }

  it("runPipeline passes with a custom registered gate, status updates, and linear sync calls chain together", async () => {
    const projectDir = setupDir();
    const slug = "test-project";

    // 1. Set up project directory with config and status
    await writeForgeConfig(projectDir, { gates: ["fake-pass"] });
    const status = makeStatus();
    await writeStatusFile(projectDir, slug, status);

    // 2. Register a fake gate and run the pipeline
    const { registerGate, runPipeline, clearGates } = await import("../../src/gates/index.js");

    clearGates();
    registerGate({
      name: "fake-pass",
      run: async () => ({
        gate: "fake-pass",
        passed: true,
        errors: [],
        durationMs: 1,
      }),
    });

    const config = makeConfig({ gates: ["fake-pass"] });
    const pipelineResult = await runPipeline(config, projectDir);

    // Verify pipeline passed
    expect(pipelineResult.result).toBe("PASSED");
    expect(pipelineResult.gates).toHaveLength(1);
    expect(pipelineResult.gates[0].passed).toBe(true);
    expect(pipelineResult.gates[0].gate).toBe("fake-pass");

    // 3. Read and update status — simulate marking milestone in_progress then complete
    const { readStatus, updateMilestoneStatus } = await import("../../src/state/status.js");

    const initialStatus = await readStatus(projectDir, slug);
    expect(initialStatus.milestones["1: Foundation"].status).toBe("pending");

    const updatedStatus = await updateMilestoneStatus(projectDir, slug, "1: Foundation", "in_progress");
    expect(updatedStatus.milestones["1: Foundation"].status).toBe("in_progress");

    const completedStatus = await updateMilestoneStatus(projectDir, slug, "1: Foundation", "complete");
    expect(completedStatus.milestones["1: Foundation"].status).toBe("complete");
    expect(completedStatus.milestones["1: Foundation"].completedAt).toBeDefined();

    // 4. Linear sync — use the real sync module (vi.mock replaces it globally for Ralph loop tests)
    const { syncMilestoneStart, syncMilestoneComplete } = await vi.importActual<
      typeof import("../../src/linear/sync.js")
    >("../../src/linear/sync.js");
    const client = mockLinearClient();

    // Suppress console output
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // syncMilestoneStart should transition issues to started
    await syncMilestoneStart(client, status, "1: Foundation");

    expect(client.resolveIssueStateByCategory).toHaveBeenCalledWith("team-1", "started", "In Progress");
    expect(client.updateIssueBatch).toHaveBeenCalledWith(
      ["issue-1", "issue-2"],
      { stateId: "state-started-uuid" },
    );
    expect(client.resolveProjectStatusByCategory).toHaveBeenCalledWith("started");
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "pstatus-started-uuid");

    // Reset mocks for complete
    vi.mocked(client.resolveIssueStateByCategory).mockClear();
    vi.mocked(client.resolveProjectStatusByCategory).mockClear();
    vi.mocked(client.updateIssueBatch).mockClear();
    vi.mocked(client.updateProjectState).mockClear();

    // syncMilestoneComplete is a no-op (issues left for PR automation)
    await syncMilestoneComplete("1: Foundation");

    // 5. Verify the chain: pipeline result feeds status update feeds sync
    const finalStatus = await readStatus(projectDir, slug);
    expect(finalStatus.milestones["1: Foundation"].status).toBe("complete");
    expect(finalStatus.milestones["2: Features"].status).toBe("pending");

    logSpy.mockRestore();
    warnSpy.mockRestore();
    clearGates();
  });

  it("pipeline FAILED result does not block status updates or linear sync", async () => {
    const projectDir = setupDir();
    const slug = "test-project";

    await writeForgeConfig(projectDir, { gates: ["fake-fail"] });
    await writeStatusFile(projectDir, slug, makeStatus());

    const { registerGate, runPipeline, clearGates } = await import("../../src/gates/index.js");

    clearGates();
    registerGate({
      name: "fake-fail",
      run: async (): Promise<GateResult> => ({
        gate: "fake-fail",
        passed: false,
        errors: [{ file: "src/foo.ts", line: 10, message: "Type mismatch" }],
        durationMs: 5,
      }),
    });

    const config = makeConfig({ gates: ["fake-fail"] });
    const pipelineResult = await runPipeline(config, projectDir);

    expect(pipelineResult.result).toBe("FAILED");
    expect(pipelineResult.gates[0].errors).toHaveLength(1);
    expect(pipelineResult.gates[0].errors[0].message).toBe("Type mismatch");

    // Status updates still work independently of pipeline result
    const { readStatus, updateMilestoneStatus } = await import("../../src/state/status.js");

    await updateMilestoneStatus(projectDir, slug, "1: Foundation", "in_progress");
    const s = await readStatus(projectDir, slug);
    expect(s.milestones["1: Foundation"].status).toBe("in_progress");

    clearGates();
  });

  it("unregistered gate is reported as FAILED in pipeline", async () => {
    const projectDir = setupDir();
    await writeForgeConfig(projectDir, { gates: ["nonexistent-gate"] });

    const { runPipeline, clearGates } = await import("../../src/gates/index.js");

    clearGates();

    const config = makeConfig({ gates: ["nonexistent-gate"] });
    const result = await runPipeline(config, projectDir);

    expect(result.result).toBe("FAILED");
    expect(result.gates[0].passed).toBe(false);
    expect(result.gates[0].errors[0].message).toContain("not registered");

    clearGates();
  });

  it("syncMilestoneComplete on last milestone is a no-op (PR automation handles transitions)", async () => {
    const { syncMilestoneComplete } = await vi.importActual<
      typeof import("../../src/linear/sync.js")
    >("../../src/linear/sync.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await syncMilestoneComplete("2: Features");
    expect(result.issuesTransitioned).toBe(0);
    expect(result.projectUpdated).toBe(false);

    logSpy.mockRestore();
  });

  it("discoverStatuses + findNextPending finds correct next milestone", async () => {
    const projectDir = setupDir();

    const status1 = makeStatus({
      slug: "project-a",
      milestones: {
        "1: Setup": { status: "complete", completedAt: new Date().toISOString() },
        "2: Build": { status: "pending" },
      },
    });
    const status2 = makeStatus({
      slug: "project-b",
      project: "Project B",
      milestones: {
        "1: Init": { status: "pending" },
      },
    });

    const statusDir = join(projectDir, ".planning", "status");
    await mkdir(statusDir, { recursive: true });
    await writeFile(join(statusDir, "project-a.json"), JSON.stringify(status1, null, 2), "utf-8");
    await writeFile(join(statusDir, "project-b.json"), JSON.stringify(status2, null, 2), "utf-8");

    const { discoverStatuses, findNextPending } = await import("../../src/state/status.js");
    const statuses = await discoverStatuses(projectDir);
    expect(statuses).toHaveLength(2);

    const pending = findNextPending(statuses);
    expect(pending).toHaveLength(2);

    const slugs = pending.map((p) => p.slug);
    expect(slugs).toContain("project-a");
    expect(slugs).toContain("project-b");

    const projectA = pending.find((p) => p.slug === "project-a");
    expect(projectA?.milestone).toBe("2: Build");

    const projectB = pending.find((p) => p.slug === "project-b");
    expect(projectB?.milestone).toBe("1: Init");
  });
});

// ---------------------------------------------------------------------------
// TEST 2: forge run (Ralph loop) end-to-end
// ---------------------------------------------------------------------------

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
  syncMilestoneStart: vi.fn().mockResolvedValue(undefined),
  syncMilestoneComplete: vi.fn().mockResolvedValue(undefined),
  syncProjectDone: vi.fn().mockResolvedValue(undefined),
}));

// Mock linear client
vi.mock("../../src/linear/client.js", () => ({
  ForgeLinearClient: vi.fn(),
}));

describe("Integration: forge run (Ralph loop) end-to-end", () => {
  const dirs: string[] = [];
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockExecFile: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const cp = await import("node:child_process");
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;

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

  it("runs one full milestone loop: worktree → claude → verify → status update → merge", async () => {
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
      },
    });
    await writePRDFile(
      projectDir,
      slug,
      "# Test PRD\n\n### Milestone 1: Foundation\nSet up the project.\n",
    );

    mockSpawnSuccess();

    const passedResult: PipelineResult = {
      result: "PASSED",
      durationMs: 50,
      gates: [{ gate: "types", passed: true, durationMs: 50, errors: [] }],
    };
    mockVerifyResult(passedResult);

    const { runRalphLoop } = await import("../../src/runner/loop.js");
    await runRalphLoop({ slug, projectDir });

    // Verify worktree was created
    const { createWorktree, mergeWorktree, removeWorktree } = await import("../../src/worktree/manager.js");
    expect(createWorktree).toHaveBeenCalledTimes(1);

    // Verify Claude was spawned
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0];
    expect(spawnArgs[0]).toBe("claude");
    expect(spawnArgs[1]).toContain("-p");

    // Verify verify was run
    expect(mockExecFile).toHaveBeenCalledTimes(1);

    // Verify worktree was merged and removed
    expect(mergeWorktree).toHaveBeenCalledTimes(1);
    expect(removeWorktree).toHaveBeenCalledTimes(1);

    // Verify status file was updated to complete
    const { readStatus } = await import("../../src/state/status.js");
    const finalStatus = await readStatus(projectDir, slug);
    expect(finalStatus.milestones["1: Foundation"].status).toBe("complete");
  });

  it("chains two milestones sequentially when both pending", async () => {
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
      durationMs: 50,
      gates: [{ gate: "types", passed: true, durationMs: 50, errors: [] }],
    };
    mockVerifyResult(passedResult);

    const { runRalphLoop } = await import("../../src/runner/loop.js");
    await runRalphLoop({ slug, projectDir });

    // Should spawn Claude twice (once per milestone)
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Both milestones should be complete
    const { readStatus } = await import("../../src/state/status.js");
    const finalStatus = await readStatus(projectDir, slug);
    expect(finalStatus.milestones["1: Foundation"].status).toBe("complete");
    expect(finalStatus.milestones["2: Features"].status).toBe("complete");

    // Worktree operations should match: 2 creates, 2 merges, 2 removes
    const { createWorktree, mergeWorktree, removeWorktree } = await import("../../src/worktree/manager.js");
    expect(createWorktree).toHaveBeenCalledTimes(2);
    expect(mergeWorktree).toHaveBeenCalledTimes(2);
    expect(removeWorktree).toHaveBeenCalledTimes(2);
  });

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

    // Worktree should be removed on failure (cleanup)
    const { removeWorktree } = await import("../../src/worktree/manager.js");
    expect(removeWorktree).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TEST 3: Skill files reference only valid CLI commands
// ---------------------------------------------------------------------------

describe("Integration: skill files reference valid forge CLI commands", () => {
  // These are all the valid commands registered in src/cli.ts (or referenced as planned/documented)
  const validCommands = [
    "verify",
    "run",
    "status",
    "setup",
    "linear-sync",
    "linear",
    "doctor",
    "update",
    "codex-poll",
    "cleanup",
  ];

  // Also valid subcommands of linear-sync (deprecated, still referenced in skill files)
  const validLinearSubcommands = [
    "start",
    "complete",
    "done",
    "list-issues",
  ];

  // Valid subcommands of the new `forge linear` command group
  const validLinearNewSubcommands = [
    "sync-start",
    "sync-complete",
    "sync-done",
    "sync-planned",
    "list-issues",
    "create-project",
    "create-milestone",
    "create-issue",
    "create-issue-batch",
    "create-project-relation",
    "create-issue-relation",
    "list-teams",
    "list-projects",
  ];

  it("all skill files exist and are readable", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    expect(skillFiles.length).toBeGreaterThanOrEqual(4);

    const expectedSkills = [
      "forge-build.md",
      "forge-capture.md",
      "forge-fix.md",
      "forge-plan.md",
      "forge-quick.md",
      "forge-setup.md",
      "forge-update.md",
    ];

    for (const expected of expectedSkills) {
      expect(skillFiles).toContain(expected);
    }
  });

  it("npx forge commands in skill files reference only valid CLI commands", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    const invalidRefs: Array<{ file: string; line: number; command: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match patterns like "npx forge <command>" and "forge <command>"
        // but skip comments/prose that happen to mention "forge" in non-command contexts
        const npxMatches = line.matchAll(/npx\s+forge\s+([a-z][\w-]*)/g);
        for (const match of npxMatches) {
          const command = match[1];
          if (!validCommands.includes(command)) {
            invalidRefs.push({ file, line: i + 1, command });
          }
        }
      }
    }

    if (invalidRefs.length > 0) {
      const details = invalidRefs
        .map((r) => `  ${r.file}:${r.line} — "npx forge ${r.command}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidRefs.length} reference(s) to non-existent forge CLI commands:\n${details}\n\nValid commands: ${validCommands.join(", ")}`,
      );
    }
  });

  it("linear-sync subcommands in skill files are valid", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    const invalidSubs: Array<{ file: string; line: number; subcommand: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const subMatches = line.matchAll(/(?:npx\s+)?forge\s+linear-sync\s+([a-z][\w-]*)/g);
        for (const match of subMatches) {
          const sub = match[1];
          if (!validLinearSubcommands.includes(sub)) {
            invalidSubs.push({ file, line: i + 1, subcommand: sub });
          }
        }
      }
    }

    if (invalidSubs.length > 0) {
      const details = invalidSubs
        .map((r) => `  ${r.file}:${r.line} — "forge linear-sync ${r.subcommand}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidSubs.length} reference(s) to non-existent linear-sync subcommands:\n${details}\n\nValid subcommands: ${validLinearSubcommands.join(", ")}`,
      );
    }
  });

  it("linear subcommands in skill files are valid", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    const invalidSubs: Array<{ file: string; line: number; subcommand: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match `forge linear <sub>` but NOT `forge linear-sync <sub>` (handled by separate test)
        const subMatches = line.matchAll(/(?:npx\s+)?forge\s+linear\s+([a-z][\w-]*)/g);
        for (const match of subMatches) {
          const sub = match[1];
          if (!validLinearNewSubcommands.includes(sub)) {
            invalidSubs.push({ file, line: i + 1, subcommand: sub });
          }
        }
      }
    }

    if (invalidSubs.length > 0) {
      const details = invalidSubs
        .map((r) => `  ${r.file}:${r.line} — "forge linear ${r.subcommand}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidSubs.length} reference(s) to non-existent linear subcommands:\n${details}\n\nValid subcommands: ${validLinearNewSubcommands.join(", ")}`,
      );
    }
  });

  it("forge verify flag references in skills use valid --gate names", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    // Gates that are known to exist or be registered
    const knownGates = ["types", "lint", "tests", "visual", "runtime", "prd", "review", "codex"];

    const invalidGates: Array<{ file: string; line: number; gate: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const gateMatch = line.match(/--gate\s+([a-z,]+)/);
        if (gateMatch) {
          const gates = gateMatch[1].split(",").map((g) => g.trim());
          for (const g of gates) {
            if (g && !knownGates.includes(g)) {
              invalidGates.push({ file, line: i + 1, gate: g });
            }
          }
        }
      }
    }

    if (invalidGates.length > 0) {
      const details = invalidGates
        .map((r) => `  ${r.file}:${r.line} — unknown gate "${r.gate}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidGates.length} reference(s) to unknown gates:\n${details}\n\nKnown gates: ${knownGates.join(", ")}`,
      );
    }
  });
});
