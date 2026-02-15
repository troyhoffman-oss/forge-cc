import { describe, it, expect, vi } from "vitest";
import {
  createMilestoneIssue,
  transitionMilestoneIssues,
  addProgressComment,
  ISSUE_STATES,
} from "../../src/linear/issues.js";
import type { LinearClient, LinearIssue } from "../../src/linear/client.js";

// ---------------------------------------------------------------------------
// Mock LinearClient factory
// ---------------------------------------------------------------------------

function createMockClient(
  overrides?: Partial<LinearClient>,
): LinearClient {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: "p1", name: "Test", state: "Backlog", url: "u" }),
    updateProject: vi.fn().mockResolvedValue({ id: "p1", name: "Test", state: "Planned", url: "u" }),
    listMilestones: vi.fn().mockResolvedValue([]),
    createMilestone: vi.fn().mockResolvedValue({ id: "m1", name: "M1", progress: 0, sortOrder: 0 }),
    listIssues: vi.fn().mockResolvedValue([]),
    createIssue: vi.fn().mockResolvedValue({
      id: "i1",
      identifier: "ENG-1",
      title: "Test Issue",
      state: "Backlog",
      url: "https://linear.app/i1",
    } as LinearIssue),
    updateIssue: vi.fn().mockResolvedValue({
      id: "i1",
      identifier: "ENG-1",
      title: "Test Issue",
      state: "In Progress",
      url: "https://linear.app/i1",
    } as LinearIssue),
    createComment: vi.fn().mockResolvedValue(undefined),
    listTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMilestoneIssue", () => {
  it("delegates to client with correct params", async () => {
    const client = createMockClient();

    const issue = await createMilestoneIssue(client, {
      title: "Implement feature X",
      description: "Full details here",
      teamId: "t1",
      projectId: "p1",
      milestoneId: "m1",
      priority: 1,
    });

    expect(issue.id).toBe("i1");
    expect(client.createIssue).toHaveBeenCalledWith({
      title: "Implement feature X",
      description: "Full details here",
      teamId: "t1",
      projectId: "p1",
      milestoneId: "m1",
      priority: 1,
    });
  });
});

describe("transitionMilestoneIssues", () => {
  it("updates all issues to target state", async () => {
    const mockUpdateIssue = vi.fn()
      .mockResolvedValueOnce({
        id: "i1", identifier: "ENG-1", title: "A", state: "Done", url: "u1",
      } as LinearIssue)
      .mockResolvedValueOnce({
        id: "i2", identifier: "ENG-2", title: "B", state: "Done", url: "u2",
      } as LinearIssue);

    const client = createMockClient({
      listIssues: vi.fn().mockResolvedValue([
        { id: "i1", identifier: "ENG-1", title: "A", state: "In Progress", url: "u1" },
        { id: "i2", identifier: "ENG-2", title: "B", state: "Todo", url: "u2" },
      ] as LinearIssue[]),
      updateIssue: mockUpdateIssue,
    });

    const result = await transitionMilestoneIssues(client, "p1", "m1", "Done");

    expect(result.updated).toBe(2);
    expect(result.issues).toHaveLength(2);
    expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
    expect(mockUpdateIssue).toHaveBeenCalledWith("i1", { state: "Done" });
    expect(mockUpdateIssue).toHaveBeenCalledWith("i2", { state: "Done" });
  });

  it("skips issues already in target state", async () => {
    const mockUpdateIssue = vi.fn().mockResolvedValue({
      id: "i2", identifier: "ENG-2", title: "B", state: "Done", url: "u2",
    } as LinearIssue);

    const client = createMockClient({
      listIssues: vi.fn().mockResolvedValue([
        { id: "i1", identifier: "ENG-1", title: "A", state: "Done", url: "u1" },
        { id: "i2", identifier: "ENG-2", title: "B", state: "In Progress", url: "u2" },
      ] as LinearIssue[]),
      updateIssue: mockUpdateIssue,
    });

    const result = await transitionMilestoneIssues(client, "p1", "m1", "Done");

    expect(result.updated).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(mockUpdateIssue).toHaveBeenCalledTimes(1);
    expect(mockUpdateIssue).toHaveBeenCalledWith("i2", { state: "Done" });
  });

  it("handles empty milestone (no issues)", async () => {
    const client = createMockClient({
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const result = await transitionMilestoneIssues(client, "p1", "m1", "Done");

    expect(result.updated).toBe(0);
    expect(result.issues).toEqual([]);
  });
});

describe("addProgressComment", () => {
  it("delegates to client.createComment", async () => {
    const client = createMockClient();

    await addProgressComment(client, "i1", "Work is 50% complete");

    expect(client.createComment).toHaveBeenCalledWith("i1", "Work is 50% complete");
  });
});
