import { join } from "node:path";
import {
  readJsonFileSync,
  writeJsonFileSync,
  generateSessionId,
} from "../utils/platform.js";
import type { UserIdentity } from "./identity.js";

export interface Session {
  id: string;
  user: string;
  email: string;
  skill: "go" | "spec";
  milestone?: string;
  branch: string;
  worktreePath: string;
  startedAt: string; // ISO timestamp
  pid: number;
  status: "active" | "stale" | "completing";
}

export interface SessionRegistry {
  sessions: Session[];
}

/**
 * Get the path to the session registry file.
 * Located at <repoRoot>/.forge/sessions.json
 */
export function getRegistryPath(repoRoot: string): string {
  return join(repoRoot, ".forge", "sessions.json");
}

/**
 * Load the session registry. Returns empty registry if file doesn't exist.
 */
export function loadRegistry(repoRoot: string): SessionRegistry {
  const data = readJsonFileSync<SessionRegistry>(getRegistryPath(repoRoot));
  if (data === null) {
    return { sessions: [] };
  }
  return data;
}

/**
 * Save the session registry atomically.
 */
export function saveRegistry(
  repoRoot: string,
  registry: SessionRegistry,
): void {
  writeJsonFileSync(getRegistryPath(repoRoot), registry);
}

/**
 * Register a new session. Returns the created session.
 */
export function registerSession(
  repoRoot: string,
  params: {
    user: UserIdentity;
    skill: "go" | "spec";
    milestone?: string;
    branch: string;
    worktreePath: string;
  },
): Session {
  const registry = loadRegistry(repoRoot);

  const session: Session = {
    id: generateSessionId(),
    user: params.user.name,
    email: params.user.email,
    skill: params.skill,
    milestone: params.milestone,
    branch: params.branch,
    worktreePath: params.worktreePath,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    status: "active",
  };

  registry.sessions.push(session);
  saveRegistry(repoRoot, registry);

  return session;
}

/**
 * Deregister (remove) a session by ID.
 */
export function deregisterSession(
  repoRoot: string,
  sessionId: string,
): void {
  const registry = loadRegistry(repoRoot);
  registry.sessions = registry.sessions.filter((s) => s.id !== sessionId);
  saveRegistry(repoRoot, registry);
}

/**
 * Update a session's status.
 */
export function updateSessionStatus(
  repoRoot: string,
  sessionId: string,
  status: Session["status"],
): void {
  const registry = loadRegistry(repoRoot);
  const session = registry.sessions.find((s) => s.id === sessionId);

  if (session) {
    session.status = status;
    saveRegistry(repoRoot, registry);
  }
}

/**
 * Check if a process with the given PID is still running.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find and mark stale sessions.
 * A session is stale if its PID is no longer running.
 */
export function detectStaleSessions(repoRoot: string): Session[] {
  const registry = loadRegistry(repoRoot);
  const newlyStale: Session[] = [];

  for (const session of registry.sessions) {
    if (session.status === "active" && !isPidAlive(session.pid)) {
      session.status = "stale";
      newlyStale.push(session);
    }
  }

  if (newlyStale.length > 0) {
    saveRegistry(repoRoot, registry);
  }

  return newlyStale;
}

/**
 * Get all active sessions.
 */
export function getActiveSessions(repoRoot: string): Session[] {
  const registry = loadRegistry(repoRoot);
  return registry.sessions.filter((s) => s.status === "active");
}

/**
 * Get a session by ID.
 */
export function getSession(
  repoRoot: string,
  sessionId: string,
): Session | null {
  const registry = loadRegistry(repoRoot);
  return registry.sessions.find((s) => s.id === sessionId) ?? null;
}
