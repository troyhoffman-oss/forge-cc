import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRegistry,
  saveRegistry,
  registerSession,
  deregisterSession,
  updateSessionStatus,
  detectStaleSessions,
  getSession,
} from "../../src/worktree/session.js";
import type { Session } from "../../src/worktree/session.js";
import type { UserIdentity } from "../../src/worktree/identity.js";
import {
  mergeSessionState,
} from "../../src/worktree/state-merge.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string;

const userA: UserIdentity = {
  name: "alice",
  email: "alice@example.com",
};

const userB: UserIdentity = {
  name: "bob",
  email: "bob@example.com",
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session-1",
    user: "alice",
    email: "alice@example.com",
    skill: "go",
    branch: "forge/alice/feature",
    worktreePath: "/tmp/worktree",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    status: "active",
    ...overrides,
  };
}

function writePlanningFile(
  baseDir: string,
  filename: string,
  content: string,
): string {
  const planningDir = join(baseDir, ".planning");
  mkdirSync(planningDir, { recursive: true });
  const filePath = join(planningDir, filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Fixtures for merge tests
// ---------------------------------------------------------------------------

const SAMPLE_STATE = `# Test Project — Project State

**Last Session:** 2026-02-10

## Milestone Progress
| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Foundation | In Progress |
| 2 | Integration | Pending |
| 3 | Polish | Pending |
`;

const SAMPLE_ROADMAP = `# Test Project — Roadmap

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Foundation | In Progress |
| 2 | Integration | Pending |
| 3 | Polish | Pending |
`;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "forge-e2e-concurrency-"));
  mkdirSync(join(tempDir, ".forge"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ===========================================================================
// 1. Session isolation tests
// ===========================================================================

describe("Session isolation", () => {
  it("two sessions registered on the same repo get unique IDs", () => {
    const s1 = registerSession(tempDir, {
      user: userA,
      skill: "go",
      milestone: "M1",
      branch: "forge/alice/feature-1",
      worktreePath: "/tmp/wt-alice",
    });

    const s2 = registerSession(tempDir, {
      user: userB,
      skill: "spec",
      milestone: "M2",
      branch: "forge/bob/feature-2",
      worktreePath: "/tmp/wt-bob",
    });

    expect(s1.id).not.toBe(s2.id);

    const registry = loadRegistry(tempDir);
    expect(registry.sessions).toHaveLength(2);
  });

  it("two sessions have independent status updates", () => {
    const s1 = registerSession(tempDir, {
      user: userA,
      skill: "go",
      branch: "forge/alice/feature-1",
      worktreePath: "/tmp/wt-alice",
    });

    const s2 = registerSession(tempDir, {
      user: userB,
      skill: "spec",
      branch: "forge/bob/feature-2",
      worktreePath: "/tmp/wt-bob",
    });

    updateSessionStatus(tempDir, s1.id, "completing");

    const updated1 = getSession(tempDir, s1.id);
    const updated2 = getSession(tempDir, s2.id);

    expect(updated1?.status).toBe("completing");
    expect(updated2?.status).toBe("active");
  });

  it("deregistering one session does not affect the other", () => {
    const s1 = registerSession(tempDir, {
      user: userA,
      skill: "go",
      branch: "forge/alice/feature-1",
      worktreePath: "/tmp/wt-alice",
    });

    const s2 = registerSession(tempDir, {
      user: userB,
      skill: "spec",
      branch: "forge/bob/feature-2",
      worktreePath: "/tmp/wt-bob",
    });

    deregisterSession(tempDir, s1.id);

    const remaining = getSession(tempDir, s2.id);
    expect(remaining).not.toBeNull();
    expect(remaining!.id).toBe(s2.id);

    const gone = getSession(tempDir, s1.id);
    expect(gone).toBeNull();

    const registry = loadRegistry(tempDir);
    expect(registry.sessions).toHaveLength(1);
  });

  it("concurrent stale detection marks only the dead session", () => {
    const s1 = makeSession({
      id: "alive-session",
      user: "alice",
      pid: process.pid,
      status: "active",
    });
    const s2 = makeSession({
      id: "dead-session",
      user: "bob",
      pid: 999999999,
      status: "active",
    });

    saveRegistry(tempDir, { sessions: [s1, s2] });

    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((pid: number, _signal?: string | number) => {
        if (pid === 999999999) {
          throw new Error("ESRCH");
        }
        return true;
      });

    const stale = detectStaleSessions(tempDir);

    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe("dead-session");

    const alive = getSession(tempDir, "alive-session");
    expect(alive?.status).toBe("active");

    killSpy.mockRestore();
  });
});

// ===========================================================================
// 2. State merge isolation tests
// ===========================================================================

describe("State merge isolation", () => {
  let mainDir: string;
  let worktreeA: string;
  let worktreeB: string;

  beforeEach(() => {
    mainDir = join(tempDir, "main-repo");
    worktreeA = join(tempDir, "worktree-a");
    worktreeB = join(tempDir, "worktree-b");
    mkdirSync(mainDir, { recursive: true });
    mkdirSync(worktreeA, { recursive: true });
    mkdirSync(worktreeB, { recursive: true });
  });

  it("two sessions completing different milestones produce correct merged state", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeA, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeA, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeB, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeB, "ROADMAP.md", SAMPLE_ROADMAP);

    const resultA = mergeSessionState(mainDir, worktreeA, 1, "2026-02-14");
    expect(resultA.stateUpdated).toBe(true);
    expect(resultA.roadmapUpdated).toBe(true);

    const resultB = mergeSessionState(mainDir, worktreeB, 2, "2026-02-15");
    expect(resultB.stateUpdated).toBe(true);

    const state = readFileSync(
      join(mainDir, ".planning", "STATE.md"),
      "utf-8",
    );
    const stateLines = state.split("\n");

    const m1StateLine = stateLines.find((l) => l.includes("| 1 |"));
    const m2StateLine = stateLines.find((l) => l.includes("| 2 |"));
    const m3StateLine = stateLines.find((l) => l.includes("| 3 |"));

    expect(m1StateLine).toContain("Complete (2026-02-14)");
    expect(m2StateLine).toContain("Complete (2026-02-15)");
    expect(m3StateLine).toContain("Pending");
  });

  it("merging the same milestone from two sessions uses last-write-wins", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeA, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeA, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeB, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeB, "ROADMAP.md", SAMPLE_ROADMAP);

    mergeSessionState(mainDir, worktreeA, 1, "2026-02-14");
    mergeSessionState(mainDir, worktreeB, 1, "2026-02-15");

    const roadmap = readFileSync(
      join(mainDir, ".planning", "ROADMAP.md"),
      "utf-8",
    );
    const m1Line = roadmap.split("\n").find((l) => l.includes("| 1 |"));
    expect(m1Line).toContain("Complete (2026-02-15)");
  });
});
