import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getRegistryPath,
  loadRegistry,
  saveRegistry,
  registerSession,
  deregisterSession,
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
    expect(session.status).toBe("active");
    expect(session.id).toBeTruthy();
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
});
