import { describe, it, expect, vi } from "vitest";
import {
  createProjectMilestone,
  getMilestoneProgress,
  findMilestoneByName,
} from "../../src/linear/milestones.js";
import type { LinearClient, LinearMilestone, LinearIssue } from "../../src/linear/client.js";

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
    createMilestone: vi.fn().mockResolvedValue({
      id: "m1",
      name: "M1",
      description: "Milestone 1",
      progress: 0,
      sortOrder: 0,
    } as LinearMilestone),
    listIssues: vi.fn().mockResolvedValue([]),
    createIssue: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-1", title: "Test", state: "Backlog", url: "u" }),
    updateIssue: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-1", title: "Test", state: "Done", url: "u" }),
    createComment: vi.fn().mockResolvedValue(undefined),
    listTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createProjectMilestone", () => {
  it("delegates to client.createMilestone with correct params", async () => {
    const client = createMockClient();

    const result = await createProjectMilestone(
      client,
      "p1",
      "Milestone Alpha",
      "Description here",
      "2026-06-01",
    );

    expect(result.id).toBe("m1");
    expect(client.createMilestone).toHaveBeenCalledWith({
      projectId: "p1",
      name: "Milestone Alpha",
      description: "Description here",
      targetDate: "2026-06-01",
    });
  });
});

describe("getMilestoneProgress", () => {
  it("counts Done issues as completed", async () => {
    const client = createMockClient({
      listMilestones: vi.fn().mockResolvedValue([
        { id: "m1", name: "M1", progress: 0, sortOrder: 0 },
      ]),
      listIssues: vi.fn().mockResolvedValue([
        { id: "i1", identifier: "T-1", title: "A", state: "Done", url: "u" },
        { id: "i2", identifier: "T-2", title: "B", state: "In Progress", url: "u" },
        { id: "i3", identifier: "T-3", title: "C", state: "Done", url: "u" },
      ] as LinearIssue[]),
    });

    const progress = await getMilestoneProgress(client, "p1", "M1");

    expect(progress.totalIssues).toBe(3);
    expect(progress.completedIssues).toBe(2);
    expect(progress.milestone.id).toBe("m1");
  });

  it("counts Canceled issues as completed", async () => {
    const client = createMockClient({
      listMilestones: vi.fn().mockResolvedValue([
        { id: "m1", name: "M1", progress: 0, sortOrder: 0 },
      ]),
      listIssues: vi.fn().mockResolvedValue([
        { id: "i1", identifier: "T-1", title: "A", state: "Canceled", url: "u" },
        { id: "i2", identifier: "T-2", title: "B", state: "Todo", url: "u" },
      ] as LinearIssue[]),
    });

    const progress = await getMilestoneProgress(client, "p1", "M1");

    expect(progress.totalIssues).toBe(2);
    expect(progress.completedIssues).toBe(1);
  });

  it("handles zero issues", async () => {
    const client = createMockClient({
      listMilestones: vi.fn().mockResolvedValue([
        { id: "m1", name: "M1", progress: 0, sortOrder: 0 },
      ]),
      listIssues: vi.fn().mockResolvedValue([]),
    });

    const progress = await getMilestoneProgress(client, "p1", "M1");

    expect(progress.totalIssues).toBe(0);
    expect(progress.completedIssues).toBe(0);
  });

  it("throws if milestone not found", async () => {
    const client = createMockClient({
      listMilestones: vi.fn().mockResolvedValue([]),
    });

    await expect(
      getMilestoneProgress(client, "p1", "Nonexistent"),
    ).rejects.toThrow('Milestone not found: "Nonexistent" in project p1');
  });
});

describe("findMilestoneByName", () => {
  it("finds by exact name", async () => {
    const client = createMockClient({
      listMilestones: vi.fn().mockResolvedValue([
        { id: "m1", name: "Alpha", progress: 0, sortOrder: 0 },
        { id: "m2", name: "Beta", progress: 0, sortOrder: 1 },
      ]),
    });

    const result = await findMilestoneByName(client, "p1", "Beta");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("m2");
  });

  it("returns null when not found", async () => {
    const client = createMockClient({
      listMilestones: vi.fn().mockResolvedValue([
        { id: "m1", name: "Alpha", progress: 0, sortOrder: 0 },
      ]),
    });

    const result = await findMilestoneByName(client, "p1", "Gamma");

    expect(result).toBeNull();
  });
});
