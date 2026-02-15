import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isValidTransition,
  createTriageProject,
  transitionProject,
  findProjectByName,
  PROJECT_STATES,
} from "../../src/linear/projects.js";
import type { LinearClient, LinearProject } from "../../src/linear/client.js";

// ---------------------------------------------------------------------------
// Mock LinearClient factory
// ---------------------------------------------------------------------------

function createMockClient(
  overrides?: Partial<LinearClient>,
): LinearClient {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({
      id: "p1",
      name: "Test",
      state: "Backlog",
      url: "https://linear.app/p1",
    } as LinearProject),
    updateProject: vi.fn().mockResolvedValue({
      id: "p1",
      name: "Test",
      state: "Planned",
      url: "https://linear.app/p1",
    } as LinearProject),
    listMilestones: vi.fn().mockResolvedValue([]),
    createMilestone: vi.fn().mockResolvedValue({ id: "m1", name: "M1", progress: 0, sortOrder: 0 }),
    listIssues: vi.fn().mockResolvedValue([]),
    createIssue: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-1", title: "Test", state: "Backlog", url: "u" }),
    updateIssue: vi.fn().mockResolvedValue({ id: "i1", identifier: "T-1", title: "Test", state: "In Progress", url: "u" }),
    createComment: vi.fn().mockResolvedValue(undefined),
    listTeams: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isValidTransition", () => {
  it("Backlog -> Planned is valid", () => {
    expect(isValidTransition("Backlog", "Planned")).toBe(true);
  });

  it("In Progress -> Done is valid (skip states)", () => {
    expect(isValidTransition("In Progress", "Done")).toBe(true);
  });

  it("Done -> Backlog is invalid (backward)", () => {
    expect(isValidTransition("Done", "Backlog")).toBe(false);
  });

  it("same state is invalid", () => {
    expect(isValidTransition("In Progress", "In Progress")).toBe(false);
  });

  it("unknown state is invalid", () => {
    expect(isValidTransition("Unknown", "Done")).toBe(false);
    expect(isValidTransition("Backlog", "Nonexistent")).toBe(false);
  });
});

describe("createTriageProject", () => {
  it("creates project with Backlog state", async () => {
    const client = createMockClient();

    const project = await createTriageProject(
      client,
      "Triage Project",
      "A new project",
      ["t1", "t2"],
    );

    expect(project.id).toBe("p1");
    expect(client.createProject).toHaveBeenCalledWith({
      name: "Triage Project",
      description: "A new project",
      teamIds: ["t1", "t2"],
      state: "Backlog",
    });
  });
});

describe("transitionProject", () => {
  it("transitions project forward", async () => {
    const client = createMockClient({
      listProjects: vi.fn().mockResolvedValue([
        { id: "p1", name: "Test", state: "Backlog", url: "u1" },
      ]),
      updateProject: vi.fn().mockResolvedValue({
        id: "p1",
        name: "Test",
        state: "Planned",
        url: "u1",
      }),
    });

    const result = await transitionProject(client, "p1", "Planned");

    expect(result.state).toBe("Planned");
    expect(client.updateProject).toHaveBeenCalledWith("p1", { state: "Planned" });
  });

  it("throws on backward transition", async () => {
    const client = createMockClient({
      listProjects: vi.fn().mockResolvedValue([
        { id: "p1", name: "Test", state: "Done", url: "u1" },
      ]),
    });

    await expect(
      transitionProject(client, "p1", "Backlog"),
    ).rejects.toThrow("Invalid project transition: Done -> Backlog");
  });

  it("throws on project not found", async () => {
    const client = createMockClient({
      listProjects: vi.fn().mockResolvedValue([]),
    });

    await expect(
      transitionProject(client, "nonexistent", "Planned"),
    ).rejects.toThrow("Project not found: nonexistent");
  });
});

describe("findProjectByName", () => {
  it("finds exact match", async () => {
    const client = createMockClient({
      listProjects: vi.fn().mockResolvedValue([
        { id: "p1", name: "My Project", state: "Backlog", url: "u1" },
      ]),
    });

    const result = await findProjectByName(client, "My Project");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("p1");
    expect(client.listProjects).toHaveBeenCalledWith({ query: "My Project" });
  });

  it("returns null when not found", async () => {
    const client = createMockClient({
      listProjects: vi.fn().mockResolvedValue([]),
    });

    const result = await findProjectByName(client, "Nonexistent");

    expect(result).toBeNull();
  });

  it("filters out partial matches", async () => {
    const client = createMockClient({
      listProjects: vi.fn().mockResolvedValue([
        { id: "p1", name: "My Project Extended", state: "Backlog", url: "u1" },
        { id: "p2", name: "My Project 2", state: "Backlog", url: "u2" },
      ]),
    });

    const result = await findProjectByName(client, "My Project");

    expect(result).toBeNull();
  });
});
