import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncPRDToLinear } from "../../src/spec/linear-sync.js";
import { createProjectMilestone } from "../../src/linear/milestones.js";
import { createMilestoneIssue } from "../../src/linear/issues.js";
import { transitionProject } from "../../src/linear/projects.js";
import type { LinearClient } from "../../src/linear/client.js";
import type { PRDData } from "../../src/spec/templates.js";

vi.mock("../../src/linear/milestones.js", () => ({
  createProjectMilestone: vi.fn(),
}));

vi.mock("../../src/linear/issues.js", () => ({
  createMilestoneIssue: vi.fn(),
}));

vi.mock("../../src/linear/projects.js", () => ({
  transitionProject: vi.fn(),
}));

const mockCreateMilestone = createProjectMilestone as unknown as ReturnType<typeof vi.fn>;
const mockCreateIssue = createMilestoneIssue as unknown as ReturnType<typeof vi.fn>;
const mockTransition = transitionProject as unknown as ReturnType<typeof vi.fn>;

const mockClient = {} as LinearClient;

const basePRD: PRDData = {
  project: "test-project",
  status: "Ready",
  branch: "feat/test",
  created: "2026-02-15",
  assignedTo: "Troy",
  overview: "Overview",
  problemStatement: "Problem",
  scope: { inScope: ["A"], outOfScope: ["B"], sacred: [] },
  userStories: [
    { id: "1", title: "Login", description: "User login", acceptanceCriteria: ["Works"] },
    { id: "2", title: "Dashboard", description: "User dashboard", acceptanceCriteria: ["Loads"] },
  ],
  technicalDesign: { dependencies: ["react"] },
  milestones: [
    {
      number: 1, name: "Foundation", goal: "Setup",
      assignedTo: "Troy",
      waves: [{ waveNumber: 1, agents: [{ name: "a1", task: "init", files: ["a.ts"] }] }],
      verificationCommands: ["npm test"],
    },
    {
      number: 2, name: "Features", goal: "Build features",
      assignedTo: "Troy",
      waves: [{ waveNumber: 1, agents: [{ name: "a2", task: "build", files: ["b.ts"] }] }],
      verificationCommands: ["npm test"],
    },
  ],
  verification: { perMilestone: ["tests pass"], overall: ["all pass"] },
};

describe("syncPRDToLinear", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates milestones and issues, distributes stories across milestones", async () => {
    mockCreateMilestone.mockImplementation((_c: any, _p: any, name: string) =>
      Promise.resolve({ id: `m-${name}`, name, progress: 0, sortOrder: 0 }),
    );
    mockCreateIssue.mockImplementation((_c: any, input: any) =>
      Promise.resolve({ id: `i-${input.title}`, identifier: "T-1", title: input.title, state: "Backlog", url: "u" }),
    );
    mockTransition.mockResolvedValue({ id: "p1", name: "Test", state: "Planned", url: "u" });

    const result = await syncPRDToLinear(basePRD, "p1", "t1", mockClient);

    expect(result.milestonesCreated).toBe(2);
    expect(result.issuesCreated).toBe(2);
    expect(result.milestones).toHaveLength(2);
    // Stories distributed round-robin: story 1 -> M1, story 2 -> M2
    expect(result.milestones[0].issues).toHaveLength(1);
    expect(result.milestones[1].issues).toHaveLength(1);
    expect(mockTransition).toHaveBeenCalledWith(mockClient, "p1", "Planned");
  });

  it("skips issues when milestone creation fails", async () => {
    // First milestone fails, second succeeds
    mockCreateMilestone
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce({ id: "m2", name: "M2", progress: 0, sortOrder: 0 });
    mockCreateIssue.mockResolvedValue({
      id: "i1", identifier: "T-1", title: "test", state: "Backlog", url: "u",
    });
    mockTransition.mockResolvedValue({ id: "p1", name: "Test", state: "Planned", url: "u" });

    const result = await syncPRDToLinear(basePRD, "p1", "t1", mockClient);

    expect(result.milestonesCreated).toBe(1);
    expect(result.errors.milestones).toHaveLength(1);
    expect(result.errors.milestones[0].prdNumber).toBe(1);
    expect(result.errors.milestones[0].error).toBe("API error");
    // Issues for failed milestone should be skipped
    expect(result.milestones).toHaveLength(1);
  });

  it("continues when issue creation fails", async () => {
    mockCreateMilestone.mockResolvedValue({ id: "m1", name: "M1", progress: 0, sortOrder: 0 });
    // First issue fails, second succeeds
    mockCreateIssue
      .mockRejectedValueOnce(new Error("Issue API error"))
      .mockResolvedValueOnce({ id: "i2", identifier: "T-2", title: "test", state: "Backlog", url: "u" });
    mockTransition.mockResolvedValue({ id: "p1", name: "Test", state: "Planned", url: "u" });

    // Use single-milestone PRD so both stories go to same milestone
    const singleMilestonePRD = { ...basePRD, milestones: [basePRD.milestones[0]] };
    const result = await syncPRDToLinear(singleMilestonePRD, "p1", "t1", mockClient);

    expect(result.issuesCreated).toBe(1);
    expect(result.errors.issues).toHaveLength(1);
    expect(result.errors.issues[0].error).toBe("Issue API error");
  });

  it("transitions project to Planned", async () => {
    mockCreateMilestone.mockResolvedValue({ id: "m1", name: "M1", progress: 0, sortOrder: 0 });
    mockCreateIssue.mockResolvedValue({
      id: "i1", identifier: "T-1", title: "test", state: "Backlog", url: "u",
    });
    mockTransition.mockResolvedValue({ id: "p1", name: "Test", state: "Planned", url: "u" });

    await syncPRDToLinear(basePRD, "p1", "t1", mockClient);

    expect(mockTransition).toHaveBeenCalledWith(mockClient, "p1", "Planned");
  });
});
