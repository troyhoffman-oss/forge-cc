import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/state/prd-status.js", () => ({
  readPRDStatus: vi.fn(),
}));
vi.mock("../../src/state/reader.js", () => ({
  readCurrentMilestone: vi.fn(),
}));
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));
vi.mock("../../src/linear/projects.js", () => ({
  findProjectByName: vi.fn(),
}));
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
vi.mock("../../src/go/linear-sync.js", () => ({
  syncMilestoneStart: vi.fn(),
  syncMilestoneComplete: vi.fn(),
  fetchProjectIssueIdentifiers: vi.fn(),
  syncProjectDone: vi.fn(),
}));

import { readPRDStatus } from "../../src/state/prd-status.js";
import { readCurrentMilestone } from "../../src/state/reader.js";
import { loadConfig } from "../../src/config/loader.js";
import { findProjectByName } from "../../src/linear/projects.js";
import { LinearClient, LinearClientError } from "../../src/linear/client.js";
import {
  syncMilestoneStart,
  syncMilestoneComplete,
  fetchProjectIssueIdentifiers,
  syncProjectDone,
} from "../../src/go/linear-sync.js";
import {
  resolveLinearProjectId,
  resolveMilestoneName,
  cliSyncStart,
  cliSyncComplete,
  cliFetchIssueIdentifiers,
  cliSyncDone,
} from "../../src/go/linear-sync-cli.js";

const mockReadPRDStatus = vi.mocked(readPRDStatus);
const mockReadCurrentMilestone = vi.mocked(readCurrentMilestone);
const mockLoadConfig = vi.mocked(loadConfig);
const mockFindProjectByName = vi.mocked(findProjectByName);
const MockLinearClient = vi.mocked(LinearClient);
const mockSyncStart = vi.mocked(syncMilestoneStart);
const mockSyncComplete = vi.mocked(syncMilestoneComplete);
const mockFetchIdentifiers = vi.mocked(fetchProjectIssueIdentifiers);
const mockSyncDone = vi.mocked(syncProjectDone);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: LinearClient constructor succeeds
  MockLinearClient.mockImplementation(() => ({}) as any);
  // Default: loadConfig returns empty config (no linearProject)
  mockLoadConfig.mockReturnValue({ gates: ["types", "lint", "tests"] } as any);
});

describe("resolveLinearProjectId", () => {
  it("returns linearProjectId from status file", async () => {
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-123",
    } as any);

    const result = await resolveLinearProjectId("/project", "my-slug");
    expect(result).toBe("proj-123");
  });

  it("falls back to name lookup from .forge.json", async () => {
    mockReadPRDStatus.mockResolvedValue({} as any);
    mockLoadConfig.mockReturnValue({
      linearProject: "My Project",
    } as any);
    mockFindProjectByName.mockResolvedValue({
      id: "proj-456",
      name: "My Project",
      state: "Planned",
      url: "https://linear.app/project/proj-456",
    });

    const result = await resolveLinearProjectId("/project", "my-slug");
    expect(result).toBe("proj-456");
  });

  it("returns null when neither configured", async () => {
    mockReadPRDStatus.mockResolvedValue(null as any);
    mockLoadConfig.mockReturnValue({} as any);

    const result = await resolveLinearProjectId("/project", "my-slug");
    expect(result).toBeNull();
  });

  it("returns null when API key missing for name lookup", async () => {
    mockReadPRDStatus.mockResolvedValue({} as any);
    mockLoadConfig.mockReturnValue({
      linearProject: "My Project",
    } as any);
    MockLinearClient.mockImplementation(() => {
      throw new (LinearClientError as any)("No API key");
    });

    const result = await resolveLinearProjectId("/project", "my-slug");
    expect(result).toBeNull();
  });
});

describe("resolveMilestoneName", () => {
  it("extracts name from PRD", async () => {
    mockReadCurrentMilestone.mockResolvedValue(
      "### Milestone 2: Linear Integration\n**Goal:** Add Linear",
    );

    const result = await resolveMilestoneName("/project", "my-slug", 2);
    expect(result).toBe("M2: Linear Integration");
  });

  it("returns fallback when milestone not found", async () => {
    mockReadCurrentMilestone.mockResolvedValue(null as any);

    const result = await resolveMilestoneName("/project", "my-slug", 3);
    expect(result).toBe("M3");
  });
});

describe("cliSyncStart", () => {
  it("calls syncMilestoneStart with correct args", async () => {
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-123",
    } as any);
    mockReadCurrentMilestone.mockResolvedValue(
      "### Milestone 1: Setup\n**Goal:** Bootstrap",
    );
    const syncResult = {
      milestone: { id: "m-1", name: "M1: Setup" },
      issuesMoved: 3,
    };
    mockSyncStart.mockResolvedValue(syncResult as any);

    const result = await cliSyncStart("/project", "my-slug", 1);

    expect(mockSyncStart).toHaveBeenCalledWith({
      projectId: "proj-123",
      milestoneNumber: 1,
      milestoneName: "M1: Setup",
    });
    expect(result).toBe(syncResult);
  });

  it("returns null when no project ID", async () => {
    mockReadPRDStatus.mockResolvedValue(null as any);
    mockLoadConfig.mockReturnValue({} as any);

    const result = await cliSyncStart("/project", "my-slug", 1);

    expect(result).toBeNull();
    expect(mockSyncStart).not.toHaveBeenCalled();
  });

  it("returns null when no API key", async () => {
    // readPRDStatus returns linearProjectId directly (no name lookup needed)
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-123",
    } as any);
    // But LinearClient constructor throws when cliSyncStart verifies the key
    MockLinearClient.mockImplementation(() => {
      throw new (LinearClientError as any)("No API key");
    });

    const result = await cliSyncStart("/project", "my-slug", 1);

    expect(result).toBeNull();
  });
});

describe("cliSyncComplete", () => {
  it("calls syncMilestoneComplete with correct args", async () => {
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-789",
    } as any);
    mockReadCurrentMilestone.mockResolvedValue(
      "### Milestone 3: Deploy\n**Goal:** Ship it",
    );
    const syncResult = {
      milestone: { id: "m-3", name: "M3: Deploy" },
      issuesClosed: 5,
    };
    mockSyncComplete.mockResolvedValue(syncResult as any);

    const result = await cliSyncComplete(
      "/project",
      "my-slug",
      3,
      true,
      "https://github.com/org/repo/pull/42",
    );

    expect(mockSyncComplete).toHaveBeenCalledWith({
      projectId: "proj-789",
      milestoneNumber: 3,
      milestoneName: "M3: Deploy",
      isLastMilestone: true,
      prUrl: "https://github.com/org/repo/pull/42",
    });
    expect(result).toBe(syncResult);
  });

  it("returns null when no project ID", async () => {
    mockReadPRDStatus.mockResolvedValue(null as any);
    mockLoadConfig.mockReturnValue({} as any);

    const result = await cliSyncComplete("/project", "my-slug", 1, false);

    expect(result).toBeNull();
    expect(mockSyncComplete).not.toHaveBeenCalled();
  });
});

describe("cliFetchIssueIdentifiers", () => {
  it("calls fetchProjectIssueIdentifiers with resolved project ID", async () => {
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-123",
    } as any);
    const fetchResult = {
      identifiers: ["MSIG-1", "MSIG-2"],
      issues: [
        { id: "i-1", identifier: "MSIG-1", title: "Issue 1" },
        { id: "i-2", identifier: "MSIG-2", title: "Issue 2" },
      ],
    };
    mockFetchIdentifiers.mockResolvedValue(fetchResult);

    const result = await cliFetchIssueIdentifiers("/project", "my-slug");

    expect(mockFetchIdentifiers).toHaveBeenCalledWith({
      projectId: "proj-123",
    });
    expect(result).toBe(fetchResult);
  });

  it("returns null when no project ID", async () => {
    mockReadPRDStatus.mockResolvedValue(null as any);
    mockLoadConfig.mockReturnValue({} as any);

    const result = await cliFetchIssueIdentifiers("/project", "my-slug");

    expect(result).toBeNull();
    expect(mockFetchIdentifiers).not.toHaveBeenCalled();
  });

  it("returns null when no API key", async () => {
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-123",
    } as any);
    MockLinearClient.mockImplementation(() => {
      throw new (LinearClientError as any)("No API key");
    });

    const result = await cliFetchIssueIdentifiers("/project", "my-slug");

    expect(result).toBeNull();
  });
});

describe("cliSyncDone", () => {
  it("calls syncProjectDone with resolved project ID", async () => {
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-789",
    } as any);
    const doneResult = { issuesUpdated: 3, projectUpdated: true };
    mockSyncDone.mockResolvedValue(doneResult);

    const result = await cliSyncDone("/project", "my-slug");

    expect(mockSyncDone).toHaveBeenCalledWith({ projectId: "proj-789" });
    expect(result).toBe(doneResult);
  });

  it("returns null when no project ID", async () => {
    mockReadPRDStatus.mockResolvedValue(null as any);
    mockLoadConfig.mockReturnValue({} as any);

    const result = await cliSyncDone("/project", "my-slug");

    expect(result).toBeNull();
    expect(mockSyncDone).not.toHaveBeenCalled();
  });

  it("returns null when no API key", async () => {
    mockReadPRDStatus.mockResolvedValue({
      linearProjectId: "proj-789",
    } as any);
    MockLinearClient.mockImplementation(() => {
      throw new (LinearClientError as any)("No API key");
    });

    const result = await cliSyncDone("/project", "my-slug");

    expect(result).toBeNull();
  });
});
