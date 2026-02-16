import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../src/state/prd-status.js", () => ({
  discoverPRDs: vi.fn(),
}));

import { discoverPRDs } from "../../src/state/prd-status.js";
import {
  discoverPendingPRDs,
  presentPRDPicker,
  presentModePicker,
  selectPRD,
} from "../../src/go/prd-selector.js";
import type { PendingPRD } from "../../src/go/prd-selector.js";

const mockDiscoverPRDs = vi.mocked(discoverPRDs);

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makePRDEntry(
  slug: string,
  milestones: Record<string, { status: string; date?: string }>,
  overrides?: { project?: string; branch?: string },
) {
  return {
    slug,
    status: {
      project: overrides?.project ?? `Project ${slug}`,
      slug,
      branch: overrides?.branch ?? `feat/${slug}`,
      createdAt: "2026-01-01",
      milestones,
    },
  };
}

// ---------------------------------------------------------------------------
// discoverPendingPRDs
// ---------------------------------------------------------------------------

describe("discoverPendingPRDs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no PRDs exist", async () => {
    mockDiscoverPRDs.mockResolvedValue([]);

    const result = await discoverPendingPRDs("/project");

    expect(result).toEqual([]);
    expect(mockDiscoverPRDs).toHaveBeenCalledWith("/project");
  });

  it("filters out PRDs with no pending milestones", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("done-prd", {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "complete", date: "2026-01-02" },
      }),
      makePRDEntry("in-progress-only", {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "in_progress" },
      }),
    ]);

    const result = await discoverPendingPRDs("/project");

    expect(result).toEqual([]);
  });

  it("includes PRDs that have at least one pending milestone", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("has-pending", {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "pending" },
        "3": { status: "pending" },
      }),
    ]);

    const result = await discoverPendingPRDs("/project");

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("has-pending");
  });

  it("computes counts correctly", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("mixed", {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "complete", date: "2026-01-02" },
        "3": { status: "in_progress" },
        "4": { status: "pending" },
        "5": { status: "pending" },
      }),
    ]);

    const result = await discoverPendingPRDs("/project");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slug: "mixed",
      project: "Project mixed",
      branch: "feat/mixed",
      pendingCount: 2,
      completeCount: 2,
      totalCount: 5,
    });
  });

  it("returns multiple PRDs when several have pending milestones", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("alpha", {
        "1": { status: "pending" },
      }),
      makePRDEntry("beta", {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "pending" },
      }),
      makePRDEntry("done", {
        "1": { status: "complete", date: "2026-01-01" },
      }),
    ]);

    const result = await discoverPendingPRDs("/project");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.slug)).toEqual(["alpha", "beta"]);
  });

  it("sets project and branch from PRD status", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry(
        "custom",
        { "1": { status: "pending" } },
        { project: "My Custom Project", branch: "feat/custom-branch" },
      ),
    ]);

    const result = await discoverPendingPRDs("/project");

    expect(result[0].project).toBe("My Custom Project");
    expect(result[0].branch).toBe("feat/custom-branch");
  });
});

// ---------------------------------------------------------------------------
// presentPRDPicker
// ---------------------------------------------------------------------------

describe("presentPRDPicker", () => {
  it("formats label with project name and completion counts", () => {
    const prds: PendingPRD[] = [
      {
        slug: "test",
        project: "forge-agent-teams",
        branch: "feat/agent-teams",
        pendingCount: 3,
        completeCount: 2,
        totalCount: 5,
      },
    ];

    const options = presentPRDPicker(prds);

    expect(options).toHaveLength(1);
    expect(options[0].label).toBe("forge-agent-teams (2/5 complete)");
  });

  it("formats description with branch and pending count (plural)", () => {
    const prds: PendingPRD[] = [
      {
        slug: "test",
        project: "My Project",
        branch: "feat/my-branch",
        pendingCount: 3,
        completeCount: 1,
        totalCount: 4,
      },
    ];

    const options = presentPRDPicker(prds);

    expect(options[0].description).toBe(
      "Branch: feat/my-branch | 3 milestones remaining",
    );
  });

  it("uses singular 'milestone' when only one pending", () => {
    const prds: PendingPRD[] = [
      {
        slug: "test",
        project: "Almost Done",
        branch: "feat/almost",
        pendingCount: 1,
        completeCount: 4,
        totalCount: 5,
      },
    ];

    const options = presentPRDPicker(prds);

    expect(options[0].description).toBe(
      "Branch: feat/almost | 1 milestone remaining",
    );
  });

  it("returns one option per PRD", () => {
    const prds: PendingPRD[] = [
      {
        slug: "a",
        project: "Alpha",
        branch: "feat/a",
        pendingCount: 2,
        completeCount: 1,
        totalCount: 3,
      },
      {
        slug: "b",
        project: "Beta",
        branch: "feat/b",
        pendingCount: 1,
        completeCount: 2,
        totalCount: 3,
      },
    ];

    const options = presentPRDPicker(prds);

    expect(options).toHaveLength(2);
    expect(options[0].label).toBe("Alpha (1/3 complete)");
    expect(options[1].label).toBe("Beta (2/3 complete)");
  });

  it("returns empty array for empty input", () => {
    const options = presentPRDPicker([]);

    expect(options).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// presentModePicker
// ---------------------------------------------------------------------------

describe("presentModePicker", () => {
  it("returns exactly two options", () => {
    const options = presentModePicker();

    expect(options).toHaveLength(2);
  });

  it("first option is Single milestone", () => {
    const options = presentModePicker();

    expect(options[0].label).toBe("Single milestone");
    expect(options[0].description).toContain("next pending milestone");
    expect(options[0].description).toContain("stop for review");
  });

  it("second option is Auto (all milestones)", () => {
    const options = presentModePicker();

    expect(options[1].label).toBe("Auto (all milestones)");
    expect(options[1].description).toContain("all pending milestones");
    expect(options[1].description).toContain("context resets");
  });
});

// ---------------------------------------------------------------------------
// selectPRD
// ---------------------------------------------------------------------------

describe("selectPRD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no PRDs have pending milestones", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("all-done", {
        "1": { status: "complete", date: "2026-01-01" },
      }),
    ]);

    const result = await selectPRD("/project");

    expect(result).toBeNull();
  });

  it("auto-selects when exactly one PRD has pending milestones", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("only-one", {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "pending" },
      }),
    ]);

    const result = await selectPRD("/project");

    expect(result).not.toBeNull();
    expect(result!.autoSelected).toBe(true);
    expect(result!.prd.slug).toBe("only-one");
    expect(result!.prd.pendingCount).toBe(1);
    expect(result!.prd.completeCount).toBe(1);
    expect(result!.prd.totalCount).toBe(2);
  });

  it("returns null when multiple PRDs have pending milestones (caller must use picker)", async () => {
    mockDiscoverPRDs.mockResolvedValue([
      makePRDEntry("first", { "1": { status: "pending" } }),
      makePRDEntry("second", { "1": { status: "pending" } }),
    ]);

    const result = await selectPRD("/project");

    expect(result).toBeNull();
  });

  it("returns null when discoverPRDs returns empty array", async () => {
    mockDiscoverPRDs.mockResolvedValue([]);

    const result = await selectPRD("/project");

    expect(result).toBeNull();
  });
});
