import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ForgeConfig, PRDStatus } from "../../src/types.js";
import type { ForgeLinearClient } from "../../src/linear/client.js";
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
        linearMilestoneId: "ms-1",
        linearIssueIds: ["issue-1", "issue-2"],
      },
      M2: {
        status: "pending",
        linearMilestoneId: "ms-2",
        linearIssueIds: ["issue-3"],
      },
    },
    ...overrides,
  };
}

function mockClient(): ForgeLinearClient {
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
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    updateProjectState: vi.fn().mockResolvedValue(undefined),
    listTeams: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
  } as unknown as ForgeLinearClient;
}

describe("Linear sync module", () => {
  let client: ForgeLinearClient;

  beforeEach(() => {
    client = mockClient();
  });

  it("syncMilestoneStart calls correct state transitions", async () => {
    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneStart(client, config, status, "M1");

    // Should resolve "In Progress" state
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "In Progress");

    // Should update each issue to inProgress
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "state-inprogress-uuid");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-2", "state-inprogress-uuid");

    // Should update project to inProgress
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-inprogress-uuid");
  });

  it("syncMilestoneComplete transitions issues to done and project to inReview when last", async () => {
    const config = makeConfig();
    const status = makeStatus();

    await syncMilestoneComplete(client, config, status, "M1", true);

    // Should resolve "Done" for issues
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Done");

    // Should update issues to done
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "state-done-uuid");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-2", "state-done-uuid");

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

    // Should update all issues across all milestones
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "state-done-uuid");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-2", "state-done-uuid");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-3", "state-done-uuid");

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
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "state-custom-active-uuid");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-2", "state-custom-active-uuid");

    // Reset and test complete with custom names
    vi.mocked(client.resolveStateId).mockClear();
    vi.mocked(client.updateIssueState).mockClear();
    vi.mocked(client.updateProjectState).mockClear();

    await syncMilestoneComplete(client, config, status, "M1", true);

    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Custom Finished");
    expect(client.resolveStateId).toHaveBeenCalledWith("team-1", "Custom Review");
    expect(client.updateProjectState).toHaveBeenCalledWith("proj-1", "state-custom-review-uuid");
  });
});
