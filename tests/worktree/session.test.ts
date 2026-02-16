import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getRegistryPath,
  loadRegistry,
  saveRegistry,
  registerSession,
  deregisterSession,
  updateSessionStatus,
  detectStaleSessions,
  getActiveSessions,
  getSession,
} from "../../src/worktree/session.js";
import type { Session, SessionRegistry } from "../../src/worktree/session.js";
import type { UserIdentity } from "../../src/worktree/identity.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string;

const mockUser: UserIdentity = {
  name: "troy",
  email: "troy@example.com",
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session-1",
    user: "troy",
    email: "troy@example.com",
    skill: "go",
    branch: "forge/troy/feature",
    worktreePath: "/tmp/worktree",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "forge-session-test-"));
  // Create the .forge directory that the registry expects
  mkdirSync(join(tempDir, ".forge"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getRegistryPath
// ---------------------------------------------------------------------------

describe("getRegistryPath", () => {
  it("returns .forge/sessions.json under repo root", () => {
    const result = getRegistryPath("/my/repo");
    expect(result).toBe(join("/my/repo", ".forge", "sessions.json"));
  });
});

// ---------------------------------------------------------------------------
// loadRegistry
// ---------------------------------------------------------------------------

describe("loadRegistry", () => {
  it("returns empty sessions array when no file exists", () => {
    const result = loadRegistry(tempDir);
    expect(result).toEqual({ sessions: [] });
  });

  it("loads existing registry from disk", () => {
    const registry: SessionRegistry = {
      sessions: [makeSession({ id: "existing-1" })],
    };
    saveRegistry(tempDir, registry);

    const result = loadRegistry(tempDir);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe("existing-1");
  });
});

// ---------------------------------------------------------------------------
// saveRegistry
// ---------------------------------------------------------------------------

describe("saveRegistry", () => {
  it("writes registry to disk as JSON", () => {
    const registry: SessionRegistry = {
      sessions: [makeSession()],
    };
    saveRegistry(tempDir, registry);

    const raw = readFileSync(join(tempDir, ".forge", "sessions.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].user).toBe("troy");
  });

  it("overwrites previous registry content", () => {
    saveRegistry(tempDir, { sessions: [makeSession({ id: "first" })] });
    saveRegistry(tempDir, { sessions: [makeSession({ id: "second" })] });

    const result = loadRegistry(tempDir);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// registerSession
// ---------------------------------------------------------------------------

describe("registerSession", () => {
  it("creates session with correct fields", () => {
    const session = registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      milestone: "M1",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });

    expect(session.user).toBe("troy");
    expect(session.email).toBe("troy@example.com");
    expect(session.skill).toBe("go");
    expect(session.milestone).toBe("M1");
    expect(session.branch).toBe("forge/troy/feature");
    expect(session.worktreePath).toBe("/tmp/wt");
    expect(session.status).toBe("active");
    expect(session.pid).toBe(process.pid);
    expect(session.id).toBeTruthy();
    expect(session.startedAt).toBeTruthy();
  });

  it("persists session to disk", () => {
    registerSession(tempDir, {
      user: mockUser,
      skill: "spec",
      branch: "forge/troy/spec",
      worktreePath: "/tmp/wt",
    });

    const registry = loadRegistry(tempDir);
    expect(registry.sessions).toHaveLength(1);
  });

  it("appends to existing sessions", () => {
    registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature-1",
      worktreePath: "/tmp/wt1",
    });
    registerSession(tempDir, {
      user: mockUser,
      skill: "spec",
      branch: "forge/troy/feature-2",
      worktreePath: "/tmp/wt2",
    });

    const registry = loadRegistry(tempDir);
    expect(registry.sessions).toHaveLength(2);
  });

  it("handles missing milestone (optional field)", () => {
    const session = registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });
    expect(session.milestone).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deregisterSession
// ---------------------------------------------------------------------------

describe("deregisterSession", () => {
  it("removes session by ID", () => {
    const session = registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });

    deregisterSession(tempDir, session.id);

    const registry = loadRegistry(tempDir);
    expect(registry.sessions).toHaveLength(0);
  });

  it("leaves other sessions intact", () => {
    const s1 = registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/f1",
      worktreePath: "/tmp/wt1",
    });
    const s2 = registerSession(tempDir, {
      user: mockUser,
      skill: "spec",
      branch: "forge/troy/f2",
      worktreePath: "/tmp/wt2",
    });

    deregisterSession(tempDir, s1.id);

    const registry = loadRegistry(tempDir);
    expect(registry.sessions).toHaveLength(1);
    expect(registry.sessions[0].id).toBe(s2.id);
  });

  it("does nothing when session ID does not exist", () => {
    registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });

    deregisterSession(tempDir, "nonexistent-id");

    const registry = loadRegistry(tempDir);
    expect(registry.sessions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// updateSessionStatus
// ---------------------------------------------------------------------------

describe("updateSessionStatus", () => {
  it("changes status field of matching session", () => {
    const session = registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });

    updateSessionStatus(tempDir, session.id, "completing");

    const updated = getSession(tempDir, session.id);
    expect(updated?.status).toBe("completing");
  });

  it("persists status change to disk", () => {
    const session = registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });

    updateSessionStatus(tempDir, session.id, "stale");

    const registry = loadRegistry(tempDir);
    expect(registry.sessions[0].status).toBe("stale");
  });

  it("does nothing for non-existent session ID", () => {
    registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });

    // Should not throw
    updateSessionStatus(tempDir, "nonexistent", "stale");

    const registry = loadRegistry(tempDir);
    expect(registry.sessions[0].status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// detectStaleSessions
// ---------------------------------------------------------------------------

describe("detectStaleSessions", () => {
  it("marks sessions with dead PIDs as stale", () => {
    // Use a PID that definitely doesn't exist
    const session = makeSession({ id: "dead-session", pid: 999999999 });
    saveRegistry(tempDir, { sessions: [session] });

    // Mock process.kill to simulate dead PID
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 999999999) {
        throw new Error("ESRCH");
      }
      return true;
    });

    const stale = detectStaleSessions(tempDir);

    expect(stale).toHaveLength(1);
    expect(stale[0].id).toBe("dead-session");
    expect(stale[0].status).toBe("stale");

    // Verify persisted
    const registry = loadRegistry(tempDir);
    expect(registry.sessions[0].status).toBe("stale");

    killSpy.mockRestore();
  });

  it("leaves sessions with alive PIDs as active", () => {
    // Use current process PID, which is definitely alive
    const session = makeSession({ id: "alive-session", pid: process.pid });
    saveRegistry(tempDir, { sessions: [session] });

    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === process.pid) {
        return true; // PID exists
      }
      throw new Error("ESRCH");
    });

    const stale = detectStaleSessions(tempDir);

    expect(stale).toHaveLength(0);

    const registry = loadRegistry(tempDir);
    expect(registry.sessions[0].status).toBe("active");

    killSpy.mockRestore();
  });

  it("skips sessions that are already stale", () => {
    const session = makeSession({
      id: "already-stale",
      pid: 999999999,
      status: "stale",
    });
    saveRegistry(tempDir, { sessions: [session] });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const stale = detectStaleSessions(tempDir);

    // Should not be in the newly-stale list
    expect(stale).toHaveLength(0);

    killSpy.mockRestore();
  });

  it("does not save when no sessions become stale", () => {
    const session = makeSession({ id: "alive", pid: process.pid });
    saveRegistry(tempDir, { sessions: [session] });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    detectStaleSessions(tempDir);

    // Registry should be unchanged — the function only saves when there are newly stale
    const registry = loadRegistry(tempDir);
    expect(registry.sessions[0].status).toBe("active");

    killSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getActiveSessions
// ---------------------------------------------------------------------------

describe("getActiveSessions", () => {
  it("returns only active sessions", () => {
    saveRegistry(tempDir, {
      sessions: [
        makeSession({ id: "active-1", status: "active" }),
        makeSession({ id: "stale-1", status: "stale" }),
        makeSession({ id: "completing-1", status: "completing" }),
        makeSession({ id: "active-2", status: "active" }),
      ],
    });

    const active = getActiveSessions(tempDir);
    expect(active).toHaveLength(2);
    expect(active.map((s) => s.id)).toEqual(["active-1", "active-2"]);
  });

  it("returns empty array when no sessions exist", () => {
    const active = getActiveSessions(tempDir);
    expect(active).toEqual([]);
  });

  it("returns empty array when all sessions are stale", () => {
    saveRegistry(tempDir, {
      sessions: [
        makeSession({ id: "stale-1", status: "stale" }),
        makeSession({ id: "stale-2", status: "stale" }),
      ],
    });

    const active = getActiveSessions(tempDir);
    expect(active).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe("getSession", () => {
  it("returns session by ID", () => {
    const created = registerSession(tempDir, {
      user: mockUser,
      skill: "go",
      branch: "forge/troy/feature",
      worktreePath: "/tmp/wt",
    });

    const result = getSession(tempDir, created.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.user).toBe("troy");
  });

  it("returns null for non-existent session ID", () => {
    const result = getSession(tempDir, "nonexistent-id");
    expect(result).toBeNull();
  });

  it("returns null when registry is empty", () => {
    const result = getSession(tempDir, "any-id");
    expect(result).toBeNull();
  });
});
