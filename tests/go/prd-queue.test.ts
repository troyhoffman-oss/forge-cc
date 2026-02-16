import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../src/state/prd-status.js", () => ({
  discoverPRDs: vi.fn(),
  findNextPendingMilestone: vi.fn(),
  countPendingMilestones: vi.fn(),
}));

vi.mock("../../src/worktree/session.js", () => ({
  getActiveSessions: vi.fn(),
}));

vi.mock("../../src/worktree/manager.js", () => ({
  getRepoRoot: vi.fn(),
}));

import {
  discoverPRDs,
  findNextPendingMilestone,
  countPendingMilestones,
} from "../../src/state/prd-status.js";
import { getActiveSessions } from "../../src/worktree/session.js";
import { getRepoRoot } from "../../src/worktree/manager.js";
import { PRDQueue } from "../../src/go/prd-queue.js";
import type { PRDQueueEntry } from "../../src/go/prd-queue.js";
import type { Session } from "../../src/worktree/session.js";

const mockDiscoverPRDs = vi.mocked(discoverPRDs);
const mockFindNextPending = vi.mocked(findNextPendingMilestone);
const mockCountPending = vi.mocked(countPendingMilestones);
const mockGetActiveSessions = vi.mocked(getActiveSessions);
const mockGetRepoRoot = vi.mocked(getRepoRoot);

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makePRDEntry(
  slug: string,
  milestones: Record<string, { status: string; date?: string }>,
  overrides?: { project?: string; branch?: string },
) {
  return {
    slug,
    status: {
      project: overrides?.project ?? `Project ${slug}`,
      slug,
      branch: overrides?.branch ?? `feat/${slug}`,
      createdAt: "2026-01-01",
      milestones,
    },
  };
}

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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRepoRoot.mockReturnValue("/repo");
  mockGetActiveSessions.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// PRDQueue.scanPRDs
// ---------------------------------------------------------------------------

describe("PRDQueue.scanPRDs", () => {
  it("returns entries with correct fields for each discovered PRD", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("alpha", {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "pending" },
        "3": { status: "pending" },
      }),
    ]);
    mockCountPending.mockResolvedValue(2);
    mockFindNextPending.mockResolvedValue({
      number: 2,
      status: { status: "pending" },
    });

    const queue = new PRDQueue("/project");
    const entries = await queue.scanPRDs();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      slug: "alpha",
      project: "Project alpha",
      branch: "feat/alpha",
      pendingMilestones: 2,
      nextMilestone: 2,
      isExecuting: false,
    });
  });

  it("returns multiple entries for multiple PRDs", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("alpha", { "1": { status: "pending" } }),
      makePRDEntry("beta", { "1": { status: "complete", date: "2026-01-01" } }),
    ]);
    mockCountPending
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    mockFindNextPending
      .mockResolvedValueOnce({ number: 1, status: { status: "pending" } })
      .mockResolvedValueOnce(null);

    const queue = new PRDQueue("/project");
    const entries = await queue.scanPRDs();

    expect(entries).toHaveLength(2);
    expect(entries[0].slug).toBe("alpha");
    expect(entries[0].pendingMilestones).toBe(1);
    expect(entries[0].nextMilestone).toBe(1);
    expect(entries[1].slug).toBe("beta");
    expect(entries[1].pendingMilestones).toBe(0);
    expect(entries[1].nextMilestone).toBeNull();
  });

  it("returns empty array when no PRDs discovered", async () => {
    mockDiscoverPRDs.mockResolvedValue([]);

    const queue = new PRDQueue("/project");
    const entries = await queue.scanPRDs();

    expect(entries).toEqual([]);
  });

  it("marks isExecuting true when active session has matching prdSlug", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("executing-prd", { "1": { status: "pending" } }),
    ]);
    mockCountPending.mockResolvedValue(1);
    mockFindNextPending.mockResolvedValue({
      number: 1,
      status: { status: "pending" },
    });
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: "executing-prd" }),
    ]);

    const queue = new PRDQueue("/project");
    const entries = await queue.scanPRDs();

    expect(entries[0].isExecuting).toBe(true);
  });

  it("marks isExecuting false when no active session matches prdSlug", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("idle-prd", { "1": { status: "pending" } }),
    ]);
    mockCountPending.mockResolvedValue(1);
    mockFindNextPending.mockResolvedValue({
      number: 1,
      status: { status: "pending" },
    });
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: "different-prd" }),
    ]);

    const queue = new PRDQueue("/project");
    const entries = await queue.scanPRDs();

    expect(entries[0].isExecuting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRDQueue.getReadyPRDs
// ---------------------------------------------------------------------------

describe("PRDQueue.getReadyPRDs", () => {
  it("returns PRDs with pending milestones that are not executing", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("ready", { "1": { status: "pending" } }),
      makePRDEntry("done", { "1": { status: "complete", date: "2026-01-01" } }),
      makePRDEntry("busy", { "1": { status: "pending" } }),
    ]);
    mockCountPending
      .mockResolvedValueOnce(1) // ready
      .mockResolvedValueOnce(0) // done
      .mockResolvedValueOnce(1); // busy
    mockFindNextPending
      .mockResolvedValueOnce({ number: 1, status: { status: "pending" } })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ number: 1, status: { status: "pending" } });
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: "busy" }),
    ]);

    const queue = new PRDQueue("/project");
    const ready = await queue.getReadyPRDs();

    expect(ready).toHaveLength(1);
    expect(ready[0].slug).toBe("ready");
  });

  it("returns empty array when all PRDs are complete", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("done-a", { "1": { status: "complete", date: "2026-01-01" } }),
      makePRDEntry("done-b", { "1": { status: "complete", date: "2026-01-01" } }),
    ]);
    mockCountPending
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    mockFindNextPending
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const queue = new PRDQueue("/project");
    const ready = await queue.getReadyPRDs();

    expect(ready).toEqual([]);
  });

  it("returns empty array when all pending PRDs are currently executing", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("busy-a", { "1": { status: "pending" } }),
      makePRDEntry("busy-b", { "1": { status: "pending" } }),
    ]);
    mockCountPending
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    mockFindNextPending
      .mockResolvedValueOnce({ number: 1, status: { status: "pending" } })
      .mockResolvedValueOnce({ number: 1, status: { status: "pending" } });
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: "busy-a" }),
      makeSession({ prdSlug: "busy-b" }),
    ]);

    const queue = new PRDQueue("/project");
    const ready = await queue.getReadyPRDs();

    expect(ready).toEqual([]);
  });

  it("returns multiple ready PRDs when available", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("ready-a", { "1": { status: "pending" } }),
      makePRDEntry("ready-b", { "1": { status: "pending" }, "2": { status: "pending" } }),
    ]);
    mockCountPending
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mockFindNextPending
      .mockResolvedValueOnce({ number: 1, status: { status: "pending" } })
      .mockResolvedValueOnce({ number: 1, status: { status: "pending" } });

    const queue = new PRDQueue("/project");
    const ready = await queue.getReadyPRDs();

    expect(ready).toHaveLength(2);
    expect(ready.map((r) => r.slug)).toEqual(["ready-a", "ready-b"]);
  });
});

// ---------------------------------------------------------------------------
// PRDQueue.isExecuting
// ---------------------------------------------------------------------------

describe("PRDQueue.isExecuting", () => {
  it("returns true when an active session has the matching prdSlug", () => {
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: "my-prd" }),
    ]);

    const queue = new PRDQueue("/project");
    expect(queue.isExecuting("my-prd")).toBe(true);
  });

  it("returns false when no active session matches the slug", () => {
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: "other-prd" }),
    ]);

    const queue = new PRDQueue("/project");
    expect(queue.isExecuting("my-prd")).toBe(false);
  });

  it("returns false when there are no active sessions", () => {
    mockGetActiveSessions.mockReturnValue([]);

    const queue = new PRDQueue("/project");
    expect(queue.isExecuting("any-slug")).toBe(false);
  });

  it("returns false when active sessions have no prdSlug set", () => {
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: undefined }),
    ]);

    const queue = new PRDQueue("/project");
    expect(queue.isExecuting("my-prd")).toBe(false);
  });

  it("matches exactly — does not do partial slug matching", () => {
    mockGetActiveSessions.mockReturnValue([
      makeSession({ prdSlug: "my-prd-extended" }),
    ]);

    const queue = new PRDQueue("/project");
    expect(queue.isExecuting("my-prd")).toBe(false);
  });

  it("uses repoRoot from constructor for session lookup", () => {
    mockGetRepoRoot.mockReturnValue("/custom/repo");
    mockGetActiveSessions.mockReturnValue([]);

    const queue = new PRDQueue("/project");
    queue.isExecuting("test");

    expect(mockGetActiveSessions).toHaveBeenCalledWith("/custom/repo");
  });
});
