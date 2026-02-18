import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/linear/client.js", () => {
  class MockLinearClientError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "LinearClientError";
    }
  }
  return {
    LinearClient: vi.fn(),
    LinearClientError: MockLinearClientError,
  };
});
vi.mock("../../src/linear/projects.js", () => ({
  transitionProject: vi.fn(),
}));
vi.mock("../../src/linear/issues.js", () => ({
  transitionMilestoneIssues: vi.fn(),
  resolveStateId: vi.fn(),
}));
vi.mock("../../src/linear/milestones.js", () => ({
  findMilestoneByName: vi.fn(),
}));

import { LinearClient, LinearClientError } from "../../src/linear/client.js";
import { transitionProject } from "../../src/linear/projects.js";
import { resolveStateId } from "../../src/linear/issues.js";
import {
  fetchProjectIssueIdentifiers,
  syncProjectDone,
} from "../../src/go/linear-sync.js";

const MockLinearClient = vi.mocked(LinearClient);
const mockTransitionProject = vi.mocked(transitionProject);
const mockResolveStateId = vi.mocked(resolveStateId);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchProjectIssueIdentifiers", () => {
  it("returns identifiers from listIssues", async () => {
    const mockListIssues = vi.fn().mockResolvedValue([
      { id: "i-1", identifier: "TEAM-10", title: "Issue A", state: "Todo", url: "" },
      { id: "i-2", identifier: "TEAM-11", title: "Issue B", state: "Todo", url: "" },
    ]);
    MockLinearClient.mockImplementation(() => ({
      listIssues: mockListIssues,
    }) as any);

    const result = await fetchProjectIssueIdentifiers({ projectId: "proj-1" });

    expect(result).toEqual({
      identifiers: ["TEAM-10", "TEAM-11"],
      issues: [
        { id: "i-1", identifier: "TEAM-10", title: "Issue A" },
        { id: "i-2", identifier: "TEAM-11", title: "Issue B" },
      ],
    });
    expect(mockListIssues).toHaveBeenCalledWith({ projectId: "proj-1" });
  });

  it("returns null when API key is missing", async () => {
    MockLinearClient.mockImplementation(() => {
      throw new (LinearClientError as any)("No API key");
    });

    const result = await fetchProjectIssueIdentifiers({ projectId: "proj-1" });

    expect(result).toBeNull();
  });

  it("returns empty identifiers for project with no issues", async () => {
    MockLinearClient.mockImplementation(() => ({
      listIssues: vi.fn().mockResolvedValue([]),
    }) as any);

    const result = await fetchProjectIssueIdentifiers({ projectId: "proj-1" });

    expect(result).toEqual({ identifiers: [], issues: [] });
  });
});

describe("syncProjectDone", () => {
  it("transitions issues and project to Done using state UUID", async () => {
    const mockUpdateIssue = vi.fn().mockResolvedValue({});
    const mockListIssues = vi.fn().mockResolvedValue([
      { id: "i-1", identifier: "TEAM-10", title: "A", state: "In Review", teamId: "team-1", url: "" },
      { id: "i-2", identifier: "TEAM-11", title: "B", state: "Done", teamId: "team-1", url: "" },
      { id: "i-3", identifier: "TEAM-12", title: "C", state: "In Progress", teamId: "team-1", url: "" },
    ]);
    MockLinearClient.mockImplementation(() => ({
      listIssues: mockListIssues,
      updateIssue: mockUpdateIssue,
    }) as any);
    mockResolveStateId.mockResolvedValue("state-done-uuid");
    mockTransitionProject.mockResolvedValue({} as any);

    const result = await syncProjectDone({ projectId: "proj-1" });

    // Should update i-1 and i-3 (skip i-2 which is already Done) using stateId
    expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
    expect(mockUpdateIssue).toHaveBeenCalledWith("i-1", { stateId: "state-done-uuid" });
    expect(mockUpdateIssue).toHaveBeenCalledWith("i-3", { stateId: "state-done-uuid" });
    expect(mockTransitionProject).toHaveBeenCalledWith(expect.anything(), "proj-1", "Done");
    expect(result).toEqual({ issuesUpdated: 2, projectUpdated: true });
  });

  it("skips Canceled issues", async () => {
    const mockUpdateIssue = vi.fn().mockResolvedValue({});
    MockLinearClient.mockImplementation(() => ({
      listIssues: vi.fn().mockResolvedValue([
        { id: "i-1", identifier: "TEAM-10", title: "A", state: "Canceled", teamId: "team-1", url: "" },
      ]),
      updateIssue: mockUpdateIssue,
    }) as any);
    mockResolveStateId.mockResolvedValue("state-done-uuid");
    mockTransitionProject.mockResolvedValue({} as any);

    const result = await syncProjectDone({ projectId: "proj-1" });

    expect(mockUpdateIssue).not.toHaveBeenCalled();
    expect(result!.issuesUpdated).toBe(0);
  });

  it("returns noop when API key is missing", async () => {
    MockLinearClient.mockImplementation(() => {
      throw new (LinearClientError as any)("No API key");
    });

    const result = await syncProjectDone({ projectId: "proj-1" });

    expect(result).toEqual({ issuesUpdated: 0, projectUpdated: false });
  });
});
