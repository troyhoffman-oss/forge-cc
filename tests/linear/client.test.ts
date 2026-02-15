import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LinearClient, LinearClientError } from "../../src/linear/client.js";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockGraphQLResponse(data: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as Response);
}

function mockGraphQLError(status: number, body = "Error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  } as unknown as Response);
}

function mockGraphQLErrors(errors: Array<{ message: string }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ errors }),
  } as Response);
}

function makeClient(): LinearClient {
  return new LinearClient("test-api-key");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LinearClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.LINEAR_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("throws if no API key is provided and env is unset", () => {
      expect(() => new LinearClient()).toThrow(LinearClientError);
      expect(() => new LinearClient()).toThrow("Linear API key not found");
    });

    it("reads LINEAR_API_KEY from environment", () => {
      process.env.LINEAR_API_KEY = "env-key";
      const client = new LinearClient();
      expect(client).toBeDefined();
    });

    it("prefers explicit key over env", async () => {
      process.env.LINEAR_API_KEY = "env-key";
      const client = new LinearClient("explicit-key");

      mockGraphQLResponse({
        teams: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      });

      await client.listTeams();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.linear.app/graphql",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "explicit-key",
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  describe("listProjects", () => {
    it("returns mapped projects", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        projects: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { id: "p1", name: "Alpha", description: "Desc", state: "Planned", url: "https://linear.app/p1" },
            { id: "p2", name: "Beta", state: "Done", url: "https://linear.app/p2" },
          ],
        },
      });

      const projects = await client.listProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({
        id: "p1",
        name: "Alpha",
        description: "Desc",
        state: "Planned",
        url: "https://linear.app/p1",
      });
    });

    it("handles pagination across 2 pages", async () => {
      const client = makeClient();

      // Page 1
      mockGraphQLResponse({
        projects: {
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          nodes: [{ id: "p1", name: "Page1", state: "Backlog", url: "u1" }],
        },
      });
      // Page 2
      mockGraphQLResponse({
        projects: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ id: "p2", name: "Page2", state: "Backlog", url: "u2" }],
        },
      });

      const projects = await client.listProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0].id).toBe("p1");
      expect(projects[1].id).toBe("p2");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("passes query filter", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        projects: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      });

      await client.listProjects({ query: "forge" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.filter).toEqual({
        name: { containsIgnoreCase: "forge" },
      });
    });
  });

  describe("createProject", () => {
    it("sends correct mutation and returns project", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        projectCreate: {
          success: true,
          project: { id: "p1", name: "New", state: "Backlog", url: "u1" },
        },
      });

      const project = await client.createProject({
        name: "New",
        teamIds: ["t1"],
        state: "Backlog",
      });

      expect(project.id).toBe("p1");
      expect(project.name).toBe("New");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.input.name).toBe("New");
      expect(body.variables.input.teamIds).toEqual(["t1"]);
    });

    it("throws on failure response", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        projectCreate: { success: false, project: null },
      });

      await expect(
        client.createProject({ name: "Bad", teamIds: ["t1"] }),
      ).rejects.toThrow("Failed to create project");
    });
  });

  describe("updateProject", () => {
    it("sends correct mutation and returns project", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        projectUpdate: {
          success: true,
          project: { id: "p1", name: "Updated", state: "Planned", url: "u1" },
        },
      });

      const project = await client.updateProject("p1", { state: "Planned" });

      expect(project.state).toBe("Planned");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.id).toBe("p1");
      expect(body.variables.input.state).toBe("Planned");
    });
  });

  // -------------------------------------------------------------------------
  // Milestones
  // -------------------------------------------------------------------------

  describe("listMilestones", () => {
    it("returns milestones for a project", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        project: {
          projectMilestones: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { id: "m1", name: "M1", description: "First", progress: 0.5, sortOrder: 1 },
            ],
          },
        },
      });

      const milestones = await client.listMilestones("p1");

      expect(milestones).toHaveLength(1);
      expect(milestones[0]).toEqual({
        id: "m1",
        name: "M1",
        description: "First",
        progress: 0.5,
        sortOrder: 1,
      });
    });
  });

  describe("createMilestone", () => {
    it("sends correct mutation and returns milestone", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        projectMilestoneCreate: {
          success: true,
          projectMilestone: { id: "m1", name: "M1", progress: 0, sortOrder: 0 },
        },
      });

      const milestone = await client.createMilestone({
        projectId: "p1",
        name: "M1",
        description: "Milestone one",
        targetDate: "2026-03-01",
      });

      expect(milestone.id).toBe("m1");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.input.projectId).toBe("p1");
      expect(body.variables.input.name).toBe("M1");
      expect(body.variables.input.description).toBe("Milestone one");
      expect(body.variables.input.targetDate).toBe("2026-03-01");
    });
  });

  // -------------------------------------------------------------------------
  // Issues
  // -------------------------------------------------------------------------

  describe("listIssues", () => {
    it("maps nested state/project/milestone correctly", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "i1",
              identifier: "ENG-1",
              title: "Do thing",
              description: "Details",
              url: "u1",
              state: { name: "In Progress" },
              project: { id: "p1" },
              projectMilestone: { id: "m1" },
            },
          ],
        },
      });

      const issues = await client.listIssues();

      expect(issues[0]).toEqual({
        id: "i1",
        identifier: "ENG-1",
        title: "Do thing",
        description: "Details",
        state: "In Progress",
        projectId: "p1",
        milestoneId: "m1",
        url: "u1",
      });
    });

    it("filters by projectId, milestoneId, and state", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      });

      await client.listIssues({
        projectId: "p1",
        milestoneId: "m1",
        state: "Done",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.filter).toEqual({
        project: { id: { eq: "p1" } },
        projectMilestone: { id: { eq: "m1" } },
        state: { name: { eqIgnoreCase: "Done" } },
      });
    });
  });

  describe("createIssue", () => {
    it("sends correct mutation and returns mapped issue", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        issueCreate: {
          success: true,
          issue: {
            id: "i1",
            identifier: "ENG-1",
            title: "New issue",
            url: "u1",
            state: { name: "Backlog" },
            project: { id: "p1" },
            projectMilestone: { id: "m1" },
          },
        },
      });

      const issue = await client.createIssue({
        title: "New issue",
        teamId: "t1",
        projectId: "p1",
        milestoneId: "m1",
        priority: 2,
      });

      expect(issue.id).toBe("i1");
      expect(issue.state).toBe("Backlog");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.input.title).toBe("New issue");
      expect(body.variables.input.teamId).toBe("t1");
      expect(body.variables.input.projectMilestoneId).toBe("m1");
      expect(body.variables.input.priority).toBe(2);
    });
  });

  describe("updateIssue", () => {
    it("sends correct mutation and returns mapped issue", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        issueUpdate: {
          success: true,
          issue: {
            id: "i1",
            identifier: "ENG-1",
            title: "Updated",
            url: "u1",
            state: { name: "Done" },
            project: null,
            projectMilestone: null,
          },
        },
      });

      const issue = await client.updateIssue("i1", { state: "Done" });

      expect(issue.state).toBe("Done");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.id).toBe("i1");
      expect(body.variables.input.stateId).toBe("Done");
    });
  });

  describe("createComment", () => {
    it("sends correct mutation", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        commentCreate: { success: true },
      });

      await client.createComment("i1", "Progress update");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables.input.issueId).toBe("i1");
      expect(body.variables.input.body).toBe("Progress update");
    });
  });

  describe("listTeams", () => {
    it("returns teams", async () => {
      const client = makeClient();
      mockGraphQLResponse({
        teams: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { id: "t1", name: "Engineering", key: "ENG" },
          ],
        },
      });

      const teams = await client.listTeams();

      expect(teams).toHaveLength(1);
      expect(teams[0]).toEqual({ id: "t1", name: "Engineering", key: "ENG" });
    });
  });

  // -------------------------------------------------------------------------
  // Retry logic
  // -------------------------------------------------------------------------

  describe("retry logic", () => {
    it("retries on 429 status", async () => {
      const client = makeClient();

      // First two calls return 429, third succeeds
      mockGraphQLError(429);
      mockGraphQLError(429);
      mockGraphQLResponse({
        teams: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      });

      const promise = client.listTeams();

      // Advance past first retry backoff (500ms)
      await vi.advanceTimersByTimeAsync(500);
      // Advance past second retry backoff (1000ms)
      await vi.advanceTimersByTimeAsync(1000);

      const teams = await promise;
      expect(teams).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("retries on 500 status", async () => {
      const client = makeClient();

      mockGraphQLError(500);
      mockGraphQLResponse({
        teams: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      });

      const promise = client.listTeams();

      // Advance past first retry backoff (500ms)
      await vi.advanceTimersByTimeAsync(500);

      const teams = await promise;
      expect(teams).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws LinearClientError on GraphQL errors", async () => {
      const client = makeClient();
      mockGraphQLErrors([
        { message: "Field not found" },
        { message: "Permission denied" },
      ]);

      await expect(client.listTeams()).rejects.toThrow(LinearClientError);
      await expect(async () => {
        mockGraphQLErrors([{ message: "Field not found" }]);
        await client.listTeams();
      }).rejects.toThrow("GraphQL errors");
    });

    it("throws on non-200 non-retryable status", async () => {
      const client = makeClient();
      mockGraphQLError(403, "Forbidden");

      await expect(client.listTeams()).rejects.toThrow(LinearClientError);
      await expect(async () => {
        mockGraphQLError(403, "Forbidden");
        await client.listTeams();
      }).rejects.toThrow("Linear API error 403");
      // Should NOT retry -- only 1 call
      expect(mockFetch).toHaveBeenCalledTimes(2); // 2 because of the 2 assertions above
    });
  });
});
