import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
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

