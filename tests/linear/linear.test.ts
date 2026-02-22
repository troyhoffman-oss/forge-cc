import { describe, it, expect, vi } from "vitest";

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

