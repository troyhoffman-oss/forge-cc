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
    listIssuesByProject: vi.fn().mockResolvedValue([]),
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

describe("empty linearIssueIds handling", () => {
  let client: ForgeLinearClient;

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
          linearMilestoneId: "ms-1",
          // No linearIssueIds
        },
      },
    });

    await syncMilestoneStart(client, config, status, "M1");

    // Should warn about missing issue IDs
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M1"'),
    );

    // Should NOT call updateIssueState
    expect(client.updateIssueState).not.toHaveBeenCalled();

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
          linearMilestoneId: "ms-1",
          // No linearIssueIds
        },
      },
    });

    await syncMilestoneComplete(client, config, status, "M1", true);

    // Should warn about missing issue IDs
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No linearIssueIds for milestone "M1"'),
    );

    // Should NOT call updateIssueState
    expect(client.updateIssueState).not.toHaveBeenCalled();

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
        M1: { status: "complete", linearMilestoneId: "ms-1" },
        M2: { status: "complete", linearMilestoneId: "ms-2" },
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

    // Should NOT call updateIssueState
    expect(client.updateIssueState).not.toHaveBeenCalled();

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
    expect(client.updateIssueState).not.toHaveBeenCalled();
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
  let client: ForgeLinearClient;

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
      expect.stringContaining('Transitioned 3 issue(s) across all milestones to "Done"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updating project proj-1 to "Done"'),
    );

    logSpy.mockRestore();
  });
});
