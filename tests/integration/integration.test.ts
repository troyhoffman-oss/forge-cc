import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Mocks for graph loop integration test (only affect this file's imports)
// ---------------------------------------------------------------------------
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock("../../src/worktree/manager.js", () => ({
  createWorktree: vi.fn().mockResolvedValue(undefined),
  mergeWorktree: vi.fn().mockResolvedValue(undefined),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/linear/sync.js", () => ({
  syncRequirementStart: vi.fn().mockResolvedValue(undefined),
  syncGraphProjectReview: vi.fn().mockResolvedValue(undefined),
  syncGraphProjectCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/linear/client.js", () => ({
  ForgeLinearClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Skill files reference only valid CLI commands
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
    "ship",
    "sync-start",
    "sync-complete",
    "sync-done",
    "sync-merged",
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

// ---------------------------------------------------------------------------
// Graph loop end-to-end integration test
// Uses real graph reader/writer on disk; mocks only Claude spawn, verify,
// worktree operations, and Linear sync.
// ---------------------------------------------------------------------------

describe("Integration: graph loop end-to-end", () => {
  let projectDir: string;
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockExecFile: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const spawnOrder: string[] = [];

  beforeEach(async () => {
    projectDir = join(tmpdir(), `forge-int-${randomUUID()}`);
    spawnOrder.length = 0;

    const cp = await import("node:child_process");
    mockSpawn = cp.spawn as unknown as ReturnType<typeof vi.fn>;
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;

    // Reset mocks for worktree/linear
    const wt = await import("../../src/worktree/manager.js");
    vi.mocked(wt.createWorktree).mockClear();
    vi.mocked(wt.mergeWorktree).mockClear();
    vi.mocked(wt.removeWorktree).mockClear();

    const sync = await import("../../src/linear/sync.js");
    vi.mocked(sync.syncRequirementStart).mockClear();
    vi.mocked(sync.syncGraphProjectReview).mockClear();
    vi.mocked(sync.syncGraphProjectCompleted).mockClear();

    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  function mockSpawnSuccess() {
    mockSpawn.mockImplementation((_cmd: string, _args: string[], opts: { cwd?: string }) => {
      // Track which worktree path Claude was spawned in to verify order
      spawnOrder.push(opts?.cwd ?? "unknown");

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

  function mockVerifyPass() {
    const passedResult = {
      result: "PASSED",
      durationMs: 100,
      gates: [{ gate: "types", passed: true, durationMs: 100, errors: [] }],
    };
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: Record<string, unknown>, callback?: Function) => {
        if (callback) {
          callback(null, { stdout: JSON.stringify(passedResult), stderr: "" });
        }
      },
    );
  }

  it("executes 2-requirement graph respecting dependency order", async () => {
    const slug = "test-int";

    // Set up real graph files on disk
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, ".forge.json"),
      JSON.stringify({ maxIterations: 3, gates: ["types"] }),
    );

    const { initGraph, writeRequirement } = await import("../../src/graph/writer.js");

    const index = {
      project: "Integration Test",
      slug,
      branch: "feat/test-int",
      createdAt: "2026-01-01T00:00:00Z",
      linear: { projectId: "proj-1", teamId: "team-1" },
      groups: { core: { name: "Core", order: 1 } },
      requirements: {
        "REQ-001": { group: "core", status: "pending" as const, dependsOn: [] },
        "REQ-002": { group: "core", status: "pending" as const, dependsOn: ["REQ-001"] },
      },
    };

    await initGraph(projectDir, slug, index, "# Integration Test\nOverview content.");

    await writeRequirement(projectDir, slug, {
      id: "REQ-001",
      title: "Foundation",
      files: { creates: ["src/foundation.ts"], modifies: [] },
      acceptance: ["Foundation module exists"],
      body: "Implement the foundation module.",
    });

    await writeRequirement(projectDir, slug, {
      id: "REQ-002",
      title: "API Layer",
      dependsOn: ["REQ-001"],
      files: { creates: ["src/api.ts"], modifies: [] },
      acceptance: ["API layer exists"],
      body: "Implement the API layer.",
    });

    mockSpawnSuccess();
    mockVerifyPass();

    // Enable Linear sync path
    const origKey = process.env.LINEAR_API_KEY;
    process.env.LINEAR_API_KEY = "test-key";

    try {
      const { runGraphLoop } = await import("../../src/runner/loop.js");
      await runGraphLoop({ slug, projectDir });
    } finally {
      if (origKey === undefined) {
        delete process.env.LINEAR_API_KEY;
      } else {
        process.env.LINEAR_API_KEY = origKey;
      }
    }

    // --- Verify final state on disk ---
    const { loadIndex } = await import("../../src/graph/reader.js");
    const finalIndex = await loadIndex(projectDir, slug);
    expect(finalIndex.requirements["REQ-001"].status).toBe("complete");
    expect(finalIndex.requirements["REQ-001"].completedAt).toBeTruthy();
    expect(finalIndex.requirements["REQ-002"].status).toBe("complete");
    expect(finalIndex.requirements["REQ-002"].completedAt).toBeTruthy();

    // --- Verify execution order ---
    // Claude spawned exactly twice (once per requirement)
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    // REQ-001 worktree path comes before REQ-002 worktree path
    expect(spawnOrder[0]).toContain("REQ-001");
    expect(spawnOrder[1]).toContain("REQ-002");

    // --- Verify worktree lifecycle ---
    const { createWorktree, mergeWorktree, removeWorktree } = await import("../../src/worktree/manager.js");
    expect(createWorktree).toHaveBeenCalledTimes(2);
    expect(mergeWorktree).toHaveBeenCalledTimes(2);
    expect(removeWorktree).toHaveBeenCalledTimes(2);

    // --- Verify Linear sync calls ---
    const { syncRequirementStart, syncGraphProjectReview } = await import("../../src/linear/sync.js");
    expect(syncRequirementStart).toHaveBeenCalledTimes(2);
    expect(syncGraphProjectReview).toHaveBeenCalledTimes(0);

    // process.exit should NOT have been called
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
