import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ForgeConfig, PRDStatus } from "../../src/types.js";
import type { ForgeLinearClient as ForgeLinearClientType } from "../../src/linear/client.js";
import {
  syncMilestoneStart,
  syncMilestoneComplete,
  syncProjectDone,
  syncProjectPlanned,
} from "../../src/linear/sync.js";

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
    resolveIssueStateByCategory: vi.fn().mockImplementation((_teamId: string, category: string) => {
      const categoryMap: Record<string, string> = {
        started: "state-started-uuid",
        completed: "state-completed-uuid",
        unstarted: "state-unstarted-uuid",
        backlog: "state-backlog-uuid",
        canceled: "state-canceled-uuid",
      };
      return Promise.resolve(categoryMap[category] ?? `state-${category}-uuid`);
    }),
    resolveProjectStatusByCategory: vi.fn().mockImplementation((category: string) => {
      const categoryMap: Record<string, string> = {
        planned: "pstatus-planned-uuid",
        started: "pstatus-started-uuid",
        completed: "pstatus-completed-uuid",
        backlog: "pstatus-backlog-uuid",
        paused: "pstatus-paused-uuid",
        canceled: "pstatus-canceled-uuid",
      };
      return Promise.resolve(categoryMap[category] ?? `pstatus-${category}-uuid`);
    }),
    getProjectStatusCategory: vi.fn().mockResolvedValue("backlog"),
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
    const status = makeStatus();

    await syncMilestoneStart(client, status, "M1");

    // Should resolve "started" category for issues with "In Progress" hint
    expect(client.resolveIssueStateByCategory).toHaveBeenCalledWith("team-1", "started", "In Progress");

    // Should batch-update issues to started
    expect(client.updateIssueBatch).toHaveBeenCalledWith(
      ["issue-1", "issue-2"],
      { stateId: "state-started-uuid" },
    );

    // Should resolve "started" category for project and update
    expect(client.resolveProjectStatusByCategory).toHaveBeenCalledWith("started");
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "pstatus-started-uuid");
  });

  it("syncMilestoneComplete is a no-op (issues left for PR automation)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await syncMilestoneComplete("M1");

    expect(result.issuesTransitioned).toBe(0);
    expect(result.projectUpdated).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('issues left for PR automation'));

    logSpy.mockRestore();
  });

  it("syncProjectDone transitions all issues and project to completed", async () => {
    const status = makeStatus();

    await syncProjectDone(client, status);

    // Should resolve "completed" category for issues
    expect(client.resolveIssueStateByCategory).toHaveBeenCalledWith("team-1", "completed");

    // Should batch-update ALL issues across all milestones in a single call
    expect(client.updateIssueBatch).toHaveBeenCalledTimes(1);
    expect(client.updateIssueBatch).toHaveBeenCalledWith(
      ["issue-1", "issue-2", "issue-3"],
      { stateId: "state-completed-uuid" },
    );

    // Should resolve "completed" category for project and update
    expect(client.resolveProjectStatusByCategory).toHaveBeenCalledWith("completed");
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "pstatus-completed-uuid");
  });

  it("syncProjectPlanned transitions project to planned", async () => {
    const status = makeStatus();

    await syncProjectPlanned(client, status);

    // Should check current status category
    expect(client.getProjectStatusCategory).toHaveBeenCalledWith("proj-1");

    // Should resolve "planned" category for project and update
    expect(client.resolveProjectStatusByCategory).toHaveBeenCalledWith("planned");
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "pstatus-planned-uuid");

    // Should not touch issues
    expect(client.resolveIssueStateByCategory).not.toHaveBeenCalled();
    expect(client.updateIssueBatch).not.toHaveBeenCalled();
  });

  it("syncProjectPlanned no-ops when project is already beyond backlog", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(client.getProjectStatusCategory).mockResolvedValue("started");
    const status = makeStatus();

    const result = await syncProjectPlanned(client, status);

    // Should check current status
    expect(client.getProjectStatusCategory).toHaveBeenCalledWith("proj-1");

    // Should NOT resolve or update — already beyond backlog
    expect(client.resolveProjectStatusByCategory).not.toHaveBeenCalled();
    expect(client.updateProjectState).not.toHaveBeenCalled();

    // Should return empty result
    expect(result.projectUpdated).toBe(false);

    // Should log skip message
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('already at "started"'),
    );

    logSpy.mockRestore();
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

    const status = makeStatus({
      milestones: {
        M1: {
          status: "in_progress",

          // No linearIssueIds
        },
      },
    });

    await syncMilestoneStart(client, status, "M1");

    // Should warn about missing issue IDs
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M1"'),
    );

    // Should NOT call updateIssueBatch
    expect(client.updateIssueBatch).not.toHaveBeenCalled();

    // Should still update project state
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "pstatus-started-uuid");

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("syncProjectDone warns per milestone when no issueIds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const status = makeStatus({
      milestones: {
        M1: { status: "complete" },
        M2: { status: "complete" },
      },
    });

    await syncProjectDone(client, status);

    // Should warn for each milestone with no issue IDs
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M1"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M2"'),
    );

    // Should NOT call updateIssueBatch
    expect(client.updateIssueBatch).not.toHaveBeenCalled();

    // Should still update project to completed
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "pstatus-completed-uuid");

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("missing linearTeamId handling", () => {
  it.each([
    { name: "syncMilestoneStart", fn: (c: any, s: any) => syncMilestoneStart(c, s, "M1") },
    { name: "syncProjectDone", fn: (c: any, s: any) => syncProjectDone(c, s) },
  ])("$name warns and returns when no teamId", async ({ fn }) => {
    const client = mockClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await fn(client, makeStatus({ linearTeamId: undefined }));
    expect(warnSpy).toHaveBeenCalledWith("[forge] No linearTeamId in status file, skipping sync");
    expect(client.resolveIssueStateByCategory).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("syncProjectPlanned warns when no projectId", async () => {
    const client = mockClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncProjectPlanned(client, makeStatus({ linearProjectId: undefined }));
    expect(warnSpy).toHaveBeenCalledWith("[forge] No linearProjectId in status file, skipping sync");
    expect(client.resolveProjectStatusByCategory).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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
    projectStatuses: vi.fn(),
    project: vi.fn(),
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

const createCases = [
  {
    name: "createProject", clientMethod: "createProject", sdkMethod: "createProject",
    input: { name: "Test Project", teamIds: ["team-1"] },
    payloadKey: "project",
    resolved: { id: "proj-1", url: "https://linear.app/proj-1" },
    expected: { id: "proj-1", url: "https://linear.app/proj-1" },
    nullError: "Project creation returned no data",
  },
  {
    name: "createMilestone", clientMethod: "createMilestone", sdkMethod: "createProjectMilestone",
    input: { name: "Milestone 1", projectId: "proj-1" },
    payloadKey: "projectMilestone",
    resolved: { id: "ms-1" }, expected: { id: "ms-1" },
    nullError: "Milestone creation returned no data",
  },
  {
    name: "createIssue", clientMethod: "createIssue", sdkMethod: "createIssue",
    input: { title: "Test Issue", teamId: "team-1" },
    payloadKey: "issue",
    resolved: { id: "issue-1", identifier: "TEAM-101" },
    expected: { id: "issue-1", identifier: "TEAM-101" },
    nullError: "Issue creation returned no data",
  },
  {
    name: "createProjectRelation", clientMethod: "createProjectRelation", sdkMethod: "createProjectRelation",
    input: { projectId: "proj-1", relatedProjectId: "proj-2", type: "related" },
    payloadKey: "projectRelation",
    resolved: { id: "rel-1" }, expected: { id: "rel-1" },
    nullError: "Project relation creation returned no data",
  },
  {
    name: "createIssueRelation", clientMethod: "createIssueRelation", sdkMethod: "createIssueRelation",
    input: { issueId: "issue-1", relatedIssueId: "issue-2", type: IssueRelationType.blocks },
    payloadKey: "issueRelation",
    resolved: { id: "irel-1" }, expected: { id: "irel-1" },
    nullError: "Issue relation creation returned no data",
  },
];

describe.each(createCases)("ForgeLinearClient.$name", (tc) => {
  it("returns success on creation", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    (client as any).client[tc.sdkMethod].mockResolvedValue({
      [tc.payloadKey]: Promise.resolve(tc.resolved),
    });
    const result = await (client as any)[tc.clientMethod](tc.input);
    expect(result).toEqual({ success: true, data: tc.expected });
  });

  it("returns error when payload is null", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    (client as any).client[tc.sdkMethod].mockResolvedValue({ [tc.payloadKey]: null });
    const result = await (client as any)[tc.clientMethod](tc.input);
    expect(result).toEqual({ success: false, error: tc.nullError });
  });

  it("returns error on API failure", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    (client as any).client[tc.sdkMethod].mockRejectedValue(new Error("API error"));
    const result = await (client as any)[tc.clientMethod](tc.input);
    expect(result).toEqual({ success: false, error: "API error" });
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
      data: { updated: 0, failed: ["issue-1"] },
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

describe("ForgeLinearClient.resolveIssueStateByCategory", () => {
  it("returns first state matching category", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.workflowStates.mockResolvedValue({
      nodes: [
        { id: "state-1", name: "In Progress", type: "started" },
        { id: "state-2", name: "In Development", type: "started" },
      ],
    });

    const result = await client.resolveIssueStateByCategory("team-1", "started");
    expect(result).toBe("state-1");
  });

  it("prefers nameHint when provided", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.workflowStates.mockResolvedValue({
      nodes: [
        { id: "state-1", name: "In Progress", type: "started" },
        { id: "state-2", name: "In Development", type: "started" },
      ],
    });

    const result = await client.resolveIssueStateByCategory("team-1", "started", "In Development");
    expect(result).toBe("state-2");
  });

  it("throws when no states match category", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.workflowStates.mockResolvedValue({ nodes: [] });

    await expect(
      client.resolveIssueStateByCategory("team-1", "started"),
    ).rejects.toThrow('No workflow states with category "started" found for team team-1');
  });
});

describe("ForgeLinearClient.resolveProjectStatusByCategory", () => {
  it("returns status matching category", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.projectStatuses.mockResolvedValue({
      nodes: [
        { id: "ps-1", name: "Backlog", type: "backlog" },
        { id: "ps-2", name: "Planned", type: "planned" },
        { id: "ps-3", name: "In Progress", type: "started" },
      ],
    });

    const result = await client.resolveProjectStatusByCategory("planned");
    expect(result).toBe("ps-2");
  });

  it("throws when no statuses match category", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.projectStatuses.mockResolvedValue({
      nodes: [{ id: "ps-1", name: "Backlog", type: "backlog" }],
    });

    await expect(
      client.resolveProjectStatusByCategory("planned"),
    ).rejects.toThrow('No project status with category "planned" found');
  });
});

describe("ForgeLinearClient.getProjectStatusCategory", () => {
  it("returns status category from project", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.project.mockResolvedValue({
      status: Promise.resolve({ type: "started", name: "In Progress" }),
    });

    const result = await client.getProjectStatusCategory("proj-1");
    expect(result).toBe("started");
  });

  it("returns null when status is null", async () => {
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.project.mockResolvedValue({
      status: Promise.resolve(null),
    });

    const result = await client.getProjectStatusCategory("proj-1");
    expect(result).toBeNull();
  });

  it("returns null on API error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new ForgeLinearClient({ apiKey: "test-key" });
    const mockSdk = (client as any).client;
    mockSdk.project.mockRejectedValue(new Error("Not found"));

    const result = await client.getProjectStatusCategory("proj-1");
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });
});

describe("sync.ts error result logging", () => {
  it.each([
    {
      name: "syncMilestoneStart batch fail", mockMethod: "updateIssueBatch" as const,
      errorMsg: "Batch update failed",
      run: (c: any, s: any) => syncMilestoneStart(c, s, "M1"),
      expected: "Batch update failed: Batch update failed",
    },
    {
      name: "syncMilestoneStart project fail", mockMethod: "updateProjectState" as const,
      errorMsg: "Project update failed",
      run: (c: any, s: any) => syncMilestoneStart(c, s, "M1"),
      expected: "Failed to update project proj-1: Project update failed",
    },
    {
      name: "syncProjectDone batch fail", mockMethod: "updateIssueBatch" as const,
      errorMsg: "Bulk failure",
      run: (c: any, s: any) => syncProjectDone(c, s),
      expected: "Batch update failed: Bulk failure",
    },
  ])("$name logs warning", async ({ mockMethod, errorMsg, run, expected }) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const failClient = mockClient();
    vi.mocked((failClient as any)[mockMethod]).mockResolvedValue({ success: false, error: errorMsg });
    await run(failClient, makeStatus());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(expected));
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
