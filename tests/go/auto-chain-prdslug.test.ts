/**
 * Auto-Chain prdSlug Propagation Tests
 *
 * Verifies that runAutoChain() passes prdSlug through to registerSession(),
 * ensuring the session registry tracks which PRD each session is executing.
 * This is critical for multi-PRD queue tracking (PRDQueue.isExecuting).
 *
 * Separated from auto-chain.test.ts because runAutoChain requires deep mocking
 * of prd-status.js, which conflicts with the re-export tests that use the real
 * filesystem.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that use them
// ---------------------------------------------------------------------------

vi.mock("../../src/state/prd-status.js", () => ({
  findNextPendingMilestone: vi.fn(),
  countPendingMilestones: vi.fn(),
  updateMilestoneStatus: vi.fn(),
  discoverPRDs: vi.fn(),
  readPRDStatus: vi.fn(),
  writePRDStatus: vi.fn(),
}));

vi.mock("../../src/state/writer.js", () => ({
  isLastMilestone: vi.fn(),
  commitMilestoneWork: vi.fn(),
}));

vi.mock("../../src/state/reader.js", () => ({
  readCurrentMilestone: vi.fn(),
  readSessionContext: vi.fn(),
}));

vi.mock("../../src/go/executor.js", () => ({
  buildMilestoneContext: vi.fn(),
}));

vi.mock("../../src/worktree/manager.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  deleteBranch: vi.fn(),
  getRepoRoot: vi.fn(),
}));

vi.mock("../../src/worktree/session.js", () => ({
  registerSession: vi.fn(),
  deregisterSession: vi.fn(),
  updateSessionStatus: vi.fn(),
  getActiveSessions: vi.fn(),
}));

vi.mock("../../src/worktree/identity.js", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("../../src/worktree/parallel.js", () => ({
  buildScheduleFromPRD: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue(""),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { runAutoChain } from "../../src/go/auto-chain.js";
import type { AutoChainOptions } from "../../src/go/auto-chain.js";
import { findNextPendingMilestone } from "../../src/state/prd-status.js";
import { isLastMilestone } from "../../src/state/writer.js";
import { readCurrentMilestone } from "../../src/state/reader.js";
import { buildMilestoneContext } from "../../src/go/executor.js";
import {
  createWorktree,
  removeWorktree,
  getRepoRoot,
} from "../../src/worktree/manager.js";
import {
  registerSession,
  deregisterSession,
  updateSessionStatus,
} from "../../src/worktree/session.js";
import { getCurrentUser } from "../../src/worktree/identity.js";

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockFindNext = vi.mocked(findNextPendingMilestone);
const mockIsLast = vi.mocked(isLastMilestone);
const mockReadMilestone = vi.mocked(readCurrentMilestone);
const mockBuildContext = vi.mocked(buildMilestoneContext);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockRemoveWorktree = vi.mocked(removeWorktree);
const mockGetRepoRoot = vi.mocked(getRepoRoot);
const mockRegisterSession = vi.mocked(registerSession);
const mockDeregisterSession = vi.mocked(deregisterSession);
const mockUpdateSessionStatus = vi.mocked(updateSessionStatus);
const mockGetCurrentUser = vi.mocked(getCurrentUser);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_PRD_SLUG = "agent-teams-prd";

function makeOptions(overrides?: Partial<AutoChainOptions>): AutoChainOptions {
  return {
    projectDir: "/project",
    prdPath: "docs/prd.md",
    config: { gates: [], version: 1 } as unknown as AutoChainOptions["config"],
    branch: "feat/agent-teams",
    project: "forge-cc",
    prdSlug: TEST_PRD_SLUG,
    activePrd: "docs/prd.md",
    developer: "troy",
    startMilestone: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockGetRepoRoot.mockReturnValue("/repo");
  mockGetCurrentUser.mockReturnValue({
    name: "troy",
    email: "troy@example.com",
  });
  mockCreateWorktree.mockReturnValue({
    worktreePath: "/tmp/worktree",
    branch: "forge/troy/agent-teams-m1",
    sessionId: "abc123",
  });
  mockRegisterSession.mockReturnValue({
    id: "session-1",
    user: "troy",
    email: "troy@example.com",
    skill: "go",
    milestone: "M1",
    prdSlug: TEST_PRD_SLUG,
    branch: "forge/troy/agent-teams-m1",
    worktreePath: "/tmp/worktree",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    status: "active",
  });
  mockDeregisterSession.mockReturnValue(undefined);
  mockRemoveWorktree.mockReturnValue(undefined);
  mockUpdateSessionStatus.mockReturnValue(undefined);
  mockReadMilestone.mockResolvedValue(
    "### Milestone 1: Test\n**Goal:** Do stuff",
  );
  mockBuildContext.mockResolvedValue({
    milestoneNumber: 1,
    milestoneName: "Test Milestone",
    milestoneGoal: "Do stuff",
    milestoneSection: "### Milestone 1: Test",
    waves: [],
    verificationCommands: [],
    sessionContext: {
      prdSlug: TEST_PRD_SLUG,
      currentMilestoneSection: "### Milestone 1: Test",
      estimatedTokens: 100,
    },
    lessons: "",
    claudeMd: "",
  });
  mockIsLast.mockResolvedValue(true); // Stop after 1 milestone
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAutoChain — prdSlug propagation to session registry", () => {
  it("passes prdSlug to registerSession when executing a milestone", async () => {
    const options = makeOptions();

    await runAutoChain(options);

    expect(mockRegisterSession).toHaveBeenCalledTimes(1);

    // Verify the second argument (params) contains prdSlug
    const registerCall = mockRegisterSession.mock.calls[0];
    const registerParams = registerCall[1];
    expect(registerParams).toMatchObject({
      prdSlug: TEST_PRD_SLUG,
      skill: "go",
    });
  });

  it("uses the exact prdSlug from options for session registration", async () => {
    const customSlug = "custom-prd-slug";
    const options = makeOptions({ prdSlug: customSlug });

    await runAutoChain(options);

    const registerCall = mockRegisterSession.mock.calls[0];
    const registerParams = registerCall[1];
    expect(registerParams.prdSlug).toBe(customSlug);
  });

  it("registers session with the worktree branch and path", async () => {
    const options = makeOptions();

    await runAutoChain(options);

    const registerCall = mockRegisterSession.mock.calls[0];
    const registerParams = registerCall[1];
    expect(registerParams.branch).toBe("forge/troy/agent-teams-m1");
    expect(registerParams.worktreePath).toBe("/tmp/worktree");
  });

  it("registers session with milestone label", async () => {
    const options = makeOptions({ startMilestone: 3 });

    await runAutoChain(options);

    const registerCall = mockRegisterSession.mock.calls[0];
    const registerParams = registerCall[1];
    expect(registerParams.milestone).toBe("M3");
  });

  it("deregisters session in finally block after milestone succeeds", async () => {
    const options = makeOptions();

    await runAutoChain(options);

    expect(mockDeregisterSession).toHaveBeenCalledTimes(1);
    expect(mockDeregisterSession).toHaveBeenCalledWith("/repo", "session-1");
  });

  it("deregisters session and cleans up worktree on buildContext error", async () => {
    mockBuildContext.mockRejectedValue(new Error("PRD parse error"));

    const options = makeOptions();

    const result = await runAutoChain(options);

    expect(result.stopped).toBe(true);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].success).toBe(false);
    expect(result.completed[0].errors).toContain("PRD parse error");
    expect(mockDeregisterSession).toHaveBeenCalledTimes(1);
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
  });

  it("does not register session when all milestones already complete", async () => {
    mockFindNext.mockResolvedValue(null);
    const options = makeOptions({ startMilestone: undefined });

    const result = await runAutoChain(options);

    expect(result.allComplete).toBe(true);
    expect(result.completed).toEqual([]);
    expect(mockRegisterSession).not.toHaveBeenCalled();
  });

  it("calls onMilestoneStart with correct milestone number and name", async () => {
    const onStart = vi.fn();
    const options = makeOptions({ onMilestoneStart: onStart });

    await runAutoChain(options);

    expect(onStart).toHaveBeenCalledWith(1, "Test Milestone");
  });

  it("calls onChainComplete with all completed milestone results", async () => {
    const onComplete = vi.fn();
    const options = makeOptions({ onChainComplete: onComplete });

    await runAutoChain(options);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const results = onComplete.mock.calls[0][0];
    expect(results).toHaveLength(1);
    expect(results[0].milestoneNumber).toBe(1);
    expect(results[0].milestoneName).toBe("Test Milestone");
  });

  it("returns allComplete: true when milestone is the last one", async () => {
    mockIsLast.mockResolvedValue(true);
    const options = makeOptions();

    const result = await runAutoChain(options);

    expect(result.allComplete).toBe(true);
    expect(result.stopped).toBe(false);
  });

  it("creates worktree before registering session", async () => {
    const callOrder: string[] = [];
    mockCreateWorktree.mockImplementation((..._args) => {
      callOrder.push("createWorktree");
      return {
        worktreePath: "/tmp/worktree",
        branch: "forge/troy/agent-teams-m1",
        sessionId: "abc123",
      };
    });
    mockRegisterSession.mockImplementation((..._args) => {
      callOrder.push("registerSession");
      return {
        id: "session-1",
        user: "troy",
        email: "troy@example.com",
        skill: "go",
        milestone: "M1",
        prdSlug: TEST_PRD_SLUG,
        branch: "forge/troy/agent-teams-m1",
        worktreePath: "/tmp/worktree",
        startedAt: new Date().toISOString(),
        pid: process.pid,
        status: "active",
      };
    });

    const options = makeOptions();
    await runAutoChain(options);

    expect(callOrder).toEqual(["createWorktree", "registerSession"]);
  });
});
