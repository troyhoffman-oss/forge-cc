import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ForgeConfig, PRDStatus } from "../../src/types.js";
import type { ForgeLinearClient as ForgeLinearClientType } from "../../src/linear/client.js";
import {
  syncMilestoneStart,
  syncMilestoneComplete,
  syncProjectDone,
} from "../../src/linear/sync.js";

function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    gates: ["types", "lint", "tests"],
    gateTimeouts: {},
    maxIterations: 5,
    linearTeam: "TEAM-1",
    linearStates: {
      planned: "Planned",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
    },
    verifyFreshness: 600000,
    forgeVersion: "1.0.0",
    ...overrides,
  };
}

function makeStatus(overrides: Partial<PRDStatus> = {}): PRDStatus {
  return {
    project: "test-project",
    slug: "test-project",
    branch: "feat/test",
    createdAt: new Date().toISOString(),
    linearProjectId: "proj-1",
    linearTeamId: "team-1",
    milestones: {
      M1: {
        status: "in_progress",

        linearIssueIds: ["issue-1", "issue-2"],
      },
      M2: {
        status: "pending",

        linearIssueIds: ["issue-3"],
      },
    },
    ...overrides,
  };
}

function mockClient(): ForgeLinearClientType {
  return {
    resolveStateId: vi.fn().mockImplementation((_teamId: string, stateName: string) => {
      const stateMap: Record<string, string> = {
        "Planned": "state-planned-uuid",
        "In Progress": "state-inprogress-uuid",
        "In Review": "state-inreview-uuid",
        "Done": "state-done-uuid",
        "Custom Active": "state-custom-active-uuid",
        "Custom Complete": "state-custom-complete-uuid",
        "Custom Review": "state-custom-review-uuid",
        "Custom Finished": "state-custom-finished-uuid",
      };
      return Promise.resolve(stateMap[stateName] ?? `state-${stateName}-uuid`);
    }),
    updateIssueState: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    updateIssueBatch: vi.fn().mockResolvedValue({ success: true, data: { updated: 2, failed: [] } }),
    updateProjectState: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    listTeams: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    listIssuesByProject: vi.fn().mockResolvedValue([]),
  } as unknown as ForgeLinearClientType;
}

describe("Linear sync module", () => {
  let client: ForgeLinearClientType;

  beforeEach(() => {
    client = mockClient();
  });

  it("syncMilestoneStart calls correct state transitions", async () => {
    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneStart(client, config, status, "M1");

    // Should resolve "In Progress" state
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "In Progress");

    // Should batch-update issues to inProgress
    expect(client.updateIssueBatch).toHaveBeenCalledWith(
      ["issue-1", "issue-2"],
      { stateId: "state-inprogress-uuid" },
    );

    // Should update project to inProgress
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-inprogress-uuid");
  });

  it("syncMilestoneComplete transitions issues to done and project to inReview when last", async () => {
    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneComplete(client, config, status, "M1", true);

    // Should resolve "Done" for issues
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Done");

    // Should batch-update issues to done
    expect(client.updateIssueBatch).toHaveBeenCalledWith(
      ["issue-1", "issue-2"],
      { stateId: "state-done-uuid" },
    );

    // Since isLast=true, should resolve "In Review" for project
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "In Review");
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-inreview-uuid");
  });

  it("syncProjectDone transitions all issues and project to done", async () => {
    const config = makeConfig();
    const status = makeStatus();

    await syncProjectDone(client, config, status);

    // Should resolve "Done" state
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Done");

    // Should batch-update ALL issues across all milestones in a single call
    expect(client.updateIssueBatch).toHaveBeenCalledTimes(1);
    expect(client.updateIssueBatch).toHaveBeenCalledWith(
      ["issue-1", "issue-2", "issue-3"],
      { stateId: "state-done-uuid" },
    );

    // Should update project to done
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-done-uuid");
  });
});

describe("configurable state mapping", () => {
  it("resolves custom state names from config", async () => {
    const client = mockClient();
    const config = makeConfig({
      linearStates: {
        planned: "Custom Active",
        inProgress: "Custom Active",
        inReview: "Custom Review",
        done: "Custom Finished",
      },
    });
    const status = makeStatus();

    await syncMilestoneStart(client, config, status, "M1");

    // Should use the custom state name from config, not the default
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Custom Active");
    expect(client.updateIssueBatch).toHaveBeenCalledWith(
      ["issue-1", "issue-2"],
      { stateId: "state-custom-active-uuid" },
    );

    // Reset and test complete with custom names
    vi.mocked(client.resolveStateId).mockClear();
    vi.mocked(client.updateIssueBatch).mockClear();
    vi.mocked(client.updateProjectState).mockClear();

    await syncMilestoneComplete(client, config, status, "M1", true);

    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Custom Finished");
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Custom Review");
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-custom-review-uuid");
  });
});

describe("empty linearIssueIds handling", () => {
  let client: ForgeLinearClientType;

  beforeEach(() => {
    client = mockClient();
  });

  it("syncMilestoneStart warns and still updates project when no issueIds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus({
      milestones: {
        M1: {
          status: "in_progress",
  
          // No linearIssueIds
        },
      },
    });

    await syncMilestoneStart(client, config, status, "M1");

    // Should warn about missing issue IDs
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M1"'),
    );

    // Should NOT call updateIssueBatch
    expect(client.updateIssueBatch).not.toHaveBeenCalled();

    // Should still update project state
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-inprogress-uuid");

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("syncMilestoneComplete warns and still transitions project when no issueIds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus({
      milestones: {
        M1: {
          status: "in_progress",
  
          // No linearIssueIds
        },
      },
    });

    await syncMilestoneComplete(client, config, status, "M1", true);

    // Should warn about missing issue IDs
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M1"'),
    );

    // Should NOT call updateIssueBatch
    expect(client.updateIssueBatch).not.toHaveBeenCalled();

    // Should still update project to inReview since isLast=true
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-inreview-uuid");

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("syncProjectDone warns per milestone when no issueIds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus({
      milestones: {
        M1: { status: "complete" },
        M2: { status: "complete" },
      },
    });

    await syncProjectDone(client, config, status);

    // Should warn for each milestone with no issue IDs
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M1"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M2"'),
    );

    // Should NOT call updateIssueBatch
    expect(client.updateIssueBatch).not.toHaveBeenCalled();

    // Should still update project to done
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-done-uuid");

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("missing linearTeamId handling", () => {
  it("syncMilestoneStart warns and returns when no teamId", async () => {
    const client = mockClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus({ linearTeamId: undefined });

    await syncMilestoneStart(client, config, status, "M1");

    expect(warnSpy).toHaveBeenCalledWith(
      "[forge] No linearTeamId in status file, skipping sync",
    );
    expect(client.resolveStateId).not.toHaveBeenCalled();
    expect(client.updateIssueBatch).not.toHaveBeenCalled();
    expect(client.updateProjectState).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("syncMilestoneComplete warns and returns when no teamId", async () => {
    const client = mockClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus({ linearTeamId: undefined });

    await syncMilestoneComplete(client, config, status, "M1", false);

    expect(warnSpy).toHaveBeenCalledWith(
      "[forge] No linearTeamId in status file, skipping sync",
    );
    expect(client.resolveStateId).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("syncProjectDone warns and returns when no teamId", async () => {
    const client = mockClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus({ linearTeamId: undefined });

    await syncProjectDone(client, config, status);

    expect(warnSpy).toHaveBeenCalledWith(
      "[forge] No linearTeamId in status file, skipping sync",
    );
    expect(client.resolveStateId).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("console output verification", () => {
  let client: ForgeLinearClientType;

  beforeEach(() => {
    client = mockClient();
  });

  it("syncMilestoneStart logs issue count and project update", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneStart(client, config, status, "M1");

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Transitioning 2 issue(s) to "In Progress"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updating project proj-1 to "In Progress"'),
    );

    logSpy.mockRestore();
  });

  it("syncMilestoneComplete logs issue count and project update when last", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneComplete(client, config, status, "M1", true);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Transitioning 2 issue(s) to "Done"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updating project proj-1 to "In Review"'),
    );

    logSpy.mockRestore();
  });

  it("syncProjectDone logs total issue count and project update", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const config = makeConfig();
    const status = makeStatus();

    await syncProjectDone(client, config, status);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Transitioning 3 issue(s) across all milestones to "Done"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updating project proj-1 to "Done"'),
    );

    logSpy.mockRestore();
  });
});

// ============================================================
// ForgeLinearClient write operations tests
// ============================================================

// Mock @linear/sdk before importing ForgeLinearClient
vi.mock("@linear/sdk", () => {
  const MockLinearClient = vi.fn().mockImplementation(() => ({
    createProject: vi.fn(),
    createProjectMilestone: vi.fn(),
    createIssue: vi.fn(),
    createIssueBatch: vi.fn(),
    createProjectRelation: vi.fn(),
    createIssueRelation: vi.fn(),
    updateIssue: vi.fn(),
    updateProject: vi.fn(),
    updateIssueBatch: vi.fn(),
    workflowStates: vi.fn(),
    teams: vi.fn(),
    issues: vi.fn(),
    projects: vi.fn(),
  }));
  return {
    LinearClient: MockLinearClient,
    IssueRelationType: {
      blocks: "blocks",
      duplicate: "duplicate",
      related: "related",
    },
  };
});

// Dynamic import so the mock is in place before the module loads
const { ForgeLinearClient } = await import("../../src/linear/client.js");
const { IssueRelationType } = await import("@linear/sdk");

describe("ForgeLinearClient.createProject", () => {
  it("returns success with id and url on successful creation", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProject.mockResolvedValue({
      project: Promise.resolve({ id: "proj-1", url: "https://linear.app/proj-1" }),
    });

    const result = await client.createProject({ name: "Test Project", teamIds: ["team-1"] });

    expect(result).toEqual({
      success: true,
      data: { id: "proj-1", url: "https://linear.app/proj-1" },
    });
    expect(mockSdk.createProject).toHaveBeenCalledWith({
      name: "Test Project",
      teamIds: ["team-1"],
    });
  });

  it("returns error when project is null (no data)", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProject.mockResolvedValue({ project: null });

    const result = await client.createProject({ name: "Test", teamIds: ["team-1"] });

    expect(result).toEqual({
      success: false,
      error: "Project creation returned no data",
    });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProject.mockRejectedValue(new Error("Network error"));

    const result = await client.createProject({ name: "Test", teamIds: ["team-1"] });

    expect(result).toEqual({ success: false, error: "Network error" });
  });
});

describe("ForgeLinearClient.createMilestone", () => {
  it("returns success with id on successful creation", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProjectMilestone.mockResolvedValue({
      projectMilestone: Promise.resolve({ id: "ms-1" }),
    });

    const result = await client.createMilestone({
      name: "Milestone 1",
      projectId: "proj-1",
    });

    expect(result).toEqual({ success: true, data: { id: "ms-1" } });
    expect(mockSdk.createProjectMilestone).toHaveBeenCalledWith({
      name: "Milestone 1",
      projectId: "proj-1",
    });
  });

  it("returns error when milestone is null (no data)", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProjectMilestone.mockResolvedValue({ projectMilestone: null });

    const result = await client.createMilestone({
      name: "Milestone 1",
      projectId: "proj-1",
    });

    expect(result).toEqual({
      success: false,
      error: "Milestone creation returned no data",
    });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProjectMilestone.mockRejectedValue(new Error("Auth failed"));

    const result = await client.createMilestone({
      name: "Milestone 1",
      projectId: "proj-1",
    });

    expect(result).toEqual({ success: false, error: "Auth failed" });
  });
});

describe("ForgeLinearClient.createIssue", () => {
  it("returns success with id and identifier on successful creation", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssue.mockResolvedValue({
      issue: Promise.resolve({ id: "issue-1", identifier: "TEAM-101" }),
    });

    const result = await client.createIssue({
      title: "Test Issue",
      teamId: "team-1",
    });

    expect(result).toEqual({
      success: true,
      data: { id: "issue-1", identifier: "TEAM-101" },
    });
  });

  it("returns error when issue is null (no data)", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssue.mockResolvedValue({ issue: null });

    const result = await client.createIssue({
      title: "Test Issue",
      teamId: "team-1",
    });

    expect(result).toEqual({
      success: false,
      error: "Issue creation returned no data",
    });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssue.mockRejectedValue(new Error("Rate limited"));

    const result = await client.createIssue({
      title: "Test Issue",
      teamId: "team-1",
    });

    expect(result).toEqual({ success: false, error: "Rate limited" });
  });
});

describe("ForgeLinearClient.createIssueBatch", () => {
  it("returns success with ids and identifiers", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssueBatch.mockResolvedValue({
      issues: [
        { id: "issue-1", identifier: "TEAM-101" },
        { id: "issue-2", identifier: "TEAM-102" },
      ],
    });

    const result = await client.createIssueBatch([
      { title: "Issue 1", teamId: "team-1" },
      { title: "Issue 2", teamId: "team-1" },
    ]);

    expect(result).toEqual({
      success: true,
      data: {
        ids: ["issue-1", "issue-2"],
        identifiers: ["TEAM-101", "TEAM-102"],
      },
    });
  });

  it("returns success with empty arrays when issues is null/undefined", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssueBatch.mockResolvedValue({ issues: null });

    const result = await client.createIssueBatch([
      { title: "Issue 1", teamId: "team-1" },
    ]);

    expect(result).toEqual({
      success: true,
      data: { ids: [], identifiers: [] },
    });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssueBatch.mockRejectedValue(new Error("Batch too large"));

    const result = await client.createIssueBatch([
      { title: "Issue 1", teamId: "team-1" },
    ]);

    expect(result).toEqual({ success: false, error: "Batch too large" });
  });
});

describe("ForgeLinearClient.createProjectRelation", () => {
  it("returns success with relation id", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProjectRelation.mockResolvedValue({
      projectRelation: Promise.resolve({ id: "rel-1" }),
    });

    const result = await client.createProjectRelation({
      projectId: "proj-1",
      relatedProjectId: "proj-2",
      type: "related",
    });

    expect(result).toEqual({ success: true, data: { id: "rel-1" } });
  });

  it("returns error when relation is null (no data)", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProjectRelation.mockResolvedValue({ projectRelation: null });

    const result = await client.createProjectRelation({
      projectId: "proj-1",
      relatedProjectId: "proj-2",
      type: "related",
    });

    expect(result).toEqual({
      success: false,
      error: "Project relation creation returned no data",
    });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createProjectRelation.mockRejectedValue(new Error("Forbidden"));

    const result = await client.createProjectRelation({
      projectId: "proj-1",
      relatedProjectId: "proj-2",
      type: "related",
    });

    expect(result).toEqual({ success: false, error: "Forbidden" });
  });
});

describe("ForgeLinearClient.createIssueRelation", () => {
  it("returns success with relation id", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssueRelation.mockResolvedValue({
      issueRelation: Promise.resolve({ id: "irel-1" }),
    });

    const result = await client.createIssueRelation({
      issueId: "issue-1",
      relatedIssueId: "issue-2",
      type: IssueRelationType.blocks as any,
    });

    expect(result).toEqual({ success: true, data: { id: "irel-1" } });
  });

  it("returns error when relation is null (no data)", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssueRelation.mockResolvedValue({ issueRelation: null });

    const result = await client.createIssueRelation({
      issueId: "issue-1",
      relatedIssueId: "issue-2",
      type: IssueRelationType.related as any,
    });

    expect(result).toEqual({
      success: false,
      error: "Issue relation creation returned no data",
    });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.createIssueRelation.mockRejectedValue(new Error("Not found"));

    const result = await client.createIssueRelation({
      issueId: "issue-1",
      relatedIssueId: "issue-2",
      type: IssueRelationType.duplicate as any,
    });

    expect(result).toEqual({ success: false, error: "Not found" });
  });
});

describe("ForgeLinearClient.updateIssueBatch", () => {
  it("returns success with updated count and empty failed array", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.updateIssueBatch.mockResolvedValue({
      issues: [{ id: "issue-1" }, { id: "issue-2" }, { id: "issue-3" }],
    });

    const result = await client.updateIssueBatch(
      ["issue-1", "issue-2", "issue-3"],
      { stateId: "state-done" },
    );

    expect(result).toEqual({
      success: true,
      data: { updated: 3, failed: [] },
    });
  });

  it("returns updated 0 when issues is null", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.updateIssueBatch.mockResolvedValue({ issues: null });

    const result = await client.updateIssueBatch(
      ["issue-1"],
      { stateId: "state-done" },
    );

    expect(result).toEqual({
      success: true,
      data: { updated: 0, failed: [] },
    });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.updateIssueBatch.mockRejectedValue(new Error("Timeout"));

    const result = await client.updateIssueBatch(
      ["issue-1"],
      { stateId: "state-done" },
    );

    expect(result).toEqual({ success: false, error: "Timeout" });
  });
});

describe("ForgeLinearClient.updateIssueState", () => {
  it("returns success result on successful update", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.updateIssue.mockResolvedValue({});

    const result = await client.updateIssueState("issue-1", "state-done");

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockSdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
  });

  it("returns error result on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.updateIssue.mockRejectedValue(new Error("Issue not found"));

    const result = await client.updateIssueState("issue-1", "state-done");

    expect(result).toEqual({ success: false, error: "Issue not found" });
  });
});

describe("ForgeLinearClient.updateProjectState", () => {
  it("returns success result on successful update", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.updateProject.mockResolvedValue({});

    const result = await client.updateProjectState("proj-1", "state-review");

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockSdk.updateProject).toHaveBeenCalledWith("proj-1", { statusId: "state-review" });
  });

  it("returns error result on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.updateProject.mockRejectedValue(new Error("Project archived"));

    const result = await client.updateProjectState("proj-1", "state-review");

    expect(result).toEqual({ success: false, error: "Project archived" });
  });
});

describe("ForgeLinearClient constructor", () => {
  it("throws when apiKey is empty", () => {
    expect(() => new ForgeLinearClient({ apiKey: "" })).toThrow(
      "LINEAR_API_KEY is required",
    );
  });
});

describe("sync.ts error result logging", () => {
  it("syncMilestoneStart logs warning when updateIssueBatch returns failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const failClient = mockClient();
    vi.mocked(failClient.updateIssueBatch).mockResolvedValue({
      success: false,
      error: "Batch update failed",
    });

    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneStart(failClient, config, status, "M1");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Batch update failed: Batch update failed"),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("syncMilestoneStart logs warning when updateProjectState returns failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const failClient = mockClient();
    vi.mocked(failClient.updateProjectState).mockResolvedValue({
      success: false,
      error: "Project update failed",
    });

    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneStart(failClient, config, status, "M1");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to update project proj-1: Project update failed"),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("syncMilestoneComplete logs warning when updateIssueBatch returns failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const failClient = mockClient();
    vi.mocked(failClient.updateIssueBatch).mockResolvedValue({
      success: false,
      error: "State transition denied",
    });

    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneComplete(failClient, config, status, "M1", true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Batch update failed: State transition denied"),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("syncProjectDone logs warning when updateIssueBatch returns failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const failClient = mockClient();
    vi.mocked(failClient.updateIssueBatch).mockResolvedValue({
      success: false,
      error: "Bulk failure",
    });

    const config = makeConfig();
    const status = makeStatus();

    await syncProjectDone(failClient, config, status);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Batch update failed: Bulk failure"),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
