import { describe, it, expect } from "vitest";
import {
  findReady,
  findBlocked,
  getTransitiveDeps,
  computeWaves,
  groupStatus,
  findDiscovered,
  isProjectComplete,
  buildRequirementContext,
} from "../../src/graph/query.js";
import type {
  GraphIndex,
  Requirement,
  RequirementFiles,
} from "../../src/graph/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeIndex(overrides?: Partial<GraphIndex>): GraphIndex {
  return {
    project: "Test",
    slug: "test",
    branch: "feat/test",
    createdAt: "2026-01-01",
    groups: {
      core: { name: "Core", order: 1 },
    },
    requirements: {
      "req-001": { group: "core", status: "complete", dependsOn: [] },
      "req-002": { group: "core", status: "pending", dependsOn: ["req-001"] },
    },
    ...overrides,
  };
}

function makeReq(id: string, partial?: Partial<Requirement>): Requirement {
  return {
    id,
    title: `Requirement ${id}`,
    files: { creates: [], modifies: [] },
    acceptance: ["it works"],
    body: "",
    ...partial,
  };
}

// ── findReady ────────────────────────────────────────────────────────

describe("findReady", () => {
  it("returns requirements with all deps complete", () => {
    const index = makeIndex();
    const ready = findReady(index);
    expect(ready).toEqual(["req-002"]);
  });

  it("respects group-level dependsOn", () => {
    const index = makeIndex({
      groups: {
        foundation: { name: "Foundation", order: 1 },
        features: { name: "Features", order: 2, dependsOn: ["foundation"] },
      },
      requirements: {
        "req-001": { group: "foundation", status: "complete", dependsOn: [] },
        "req-002": {
          group: "foundation",
          status: "in_progress",
          dependsOn: [],
        },
        "req-003": {
          group: "features",
          status: "pending",
          dependsOn: [],
        },
      },
    });
    // features depends on foundation, but req-002 is in_progress so foundation is incomplete
    const ready = findReady(index);
    expect(ready).not.toContain("req-003");
    expect(ready).toEqual([]);
  });

  it("sorts by priority descending, then group order, then insertion order", () => {
    const index = makeIndex({
      groups: {
        alpha: { name: "Alpha", order: 1 },
        beta: { name: "Beta", order: 2 },
      },
      requirements: {
        "req-a": {
          group: "alpha",
          status: "pending",
          dependsOn: [],
          priority: 1,
        },
        "req-b": {
          group: "beta",
          status: "pending",
          dependsOn: [],
          priority: 5,
        },
        "req-c": {
          group: "alpha",
          status: "pending",
          dependsOn: [],
          priority: 1,
        },
        "req-d": {
          group: "alpha",
          status: "pending",
          dependsOn: [],
          priority: 3,
        },
      },
    });
    const ready = findReady(index);
    // req-b (priority 5) first, then req-d (priority 3, alpha),
    // then req-a and req-c (both priority 1, alpha, insertion order)
    expect(ready).toEqual(["req-b", "req-d", "req-a", "req-c"]);
  });

  it("returns empty when all requirements are complete", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": { group: "core", status: "complete", dependsOn: [] },
      },
    });
    expect(findReady(index)).toEqual([]);
  });

  it("returns empty when all pending requirements are blocked", () => {
    const index = makeIndex({
      requirements: {
        "req-001": {
          group: "core",
          status: "in_progress",
          dependsOn: [],
        },
        "req-002": {
          group: "core",
          status: "pending",
          dependsOn: ["req-001"],
        },
      },
    });
    expect(findReady(index)).toEqual([]);
  });
});

// ── findBlocked ──────────────────────────────────────────────────────

describe("findBlocked", () => {
  it("returns pending requirements with unmet requirement-level deps", () => {
    const index = makeIndex({
      requirements: {
        "req-001": {
          group: "core",
          status: "in_progress",
          dependsOn: [],
        },
        "req-002": {
          group: "core",
          status: "pending",
          dependsOn: ["req-001"],
        },
      },
    });
    const blocked = findBlocked(index);
    expect(blocked).toEqual([
      { id: "req-002", blockedBy: ["req-001"] },
    ]);
  });

  it("includes group-level blockers prefixed with group:", () => {
    const index = makeIndex({
      groups: {
        foundation: { name: "Foundation", order: 1 },
        features: { name: "Features", order: 2, dependsOn: ["foundation"] },
      },
      requirements: {
        "req-001": {
          group: "foundation",
          status: "in_progress",
          dependsOn: [],
        },
        "req-002": {
          group: "features",
          status: "pending",
          dependsOn: [],
        },
      },
    });
    const blocked = findBlocked(index);
    expect(blocked).toEqual([
      { id: "req-002", blockedBy: ["group:foundation"] },
    ]);
  });
});

// ── getTransitiveDeps ────────────────────────────────────────────────

describe("getTransitiveDeps", () => {
  it("returns topological order — deps first, target last", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": {
          group: "core",
          status: "pending",
          dependsOn: ["req-001"],
        },
        "req-003": {
          group: "core",
          status: "pending",
          dependsOn: ["req-002"],
        },
      },
    });
    const deps = getTransitiveDeps(index, "req-003");
    expect(deps).toEqual(["req-001", "req-002", "req-003"]);
  });

  it("throws on cycle", () => {
    const index = makeIndex({
      requirements: {
        "req-001": {
          group: "core",
          status: "pending",
          dependsOn: ["req-002"],
        },
        "req-002": {
          group: "core",
          status: "pending",
          dependsOn: ["req-001"],
        },
      },
    });
    expect(() => getTransitiveDeps(index, "req-001")).toThrow(/[Cc]ycle/);
  });

  it("handles diamond dependencies correctly", () => {
    // A -> B, A -> C, B -> D, C -> D
    const index = makeIndex({
      requirements: {
        "A": { group: "core", status: "pending", dependsOn: ["B", "C"] },
        "B": { group: "core", status: "pending", dependsOn: ["D"] },
        "C": { group: "core", status: "pending", dependsOn: ["D"] },
        "D": { group: "core", status: "complete", dependsOn: [] },
      },
    });
    const deps = getTransitiveDeps(index, "A");
    // D must come before B and C, all before A
    expect(deps.indexOf("D")).toBeLessThan(deps.indexOf("B"));
    expect(deps.indexOf("D")).toBeLessThan(deps.indexOf("C"));
    expect(deps.indexOf("B")).toBeLessThan(deps.indexOf("A"));
    expect(deps.indexOf("C")).toBeLessThan(deps.indexOf("A"));
    expect(deps[deps.length - 1]).toBe("A");
  });
});

// ── computeWaves ─────────────────────────────────────────────────────

describe("computeWaves", () => {
  it("separates requirements with file conflicts into different waves", () => {
    const reqs = new Map<string, Requirement>([
      [
        "req-001",
        makeReq("req-001", {
          files: { creates: [], modifies: ["src/config.ts"] },
        }),
      ],
      [
        "req-002",
        makeReq("req-002", {
          files: { creates: [], modifies: ["src/config.ts"] },
        }),
      ],
    ]);
    const waves = computeWaves(["req-001", "req-002"], reqs);
    expect(waves.length).toBe(2);
    expect(waves[0]).toEqual(["req-001"]);
    expect(waves[1]).toEqual(["req-002"]);
  });

  it("groups non-conflicting requirements in the same wave", () => {
    const reqs = new Map<string, Requirement>([
      [
        "req-001",
        makeReq("req-001", {
          files: { creates: ["src/a.ts"], modifies: [] },
        }),
      ],
      [
        "req-002",
        makeReq("req-002", {
          files: { creates: ["src/b.ts"], modifies: [] },
        }),
      ],
    ]);
    const waves = computeWaves(["req-001", "req-002"], reqs);
    expect(waves.length).toBe(1);
    expect(waves[0]).toEqual(["req-001", "req-002"]);
  });

  it("returns single wave when no file conflicts", () => {
    const reqs = new Map<string, Requirement>([
      [
        "req-001",
        makeReq("req-001", {
          files: { creates: ["src/x.ts"], modifies: [] },
        }),
      ],
      [
        "req-002",
        makeReq("req-002", {
          files: { creates: ["src/y.ts"], modifies: [] },
        }),
      ],
      [
        "req-003",
        makeReq("req-003", {
          files: { creates: ["src/z.ts"], modifies: [] },
        }),
      ],
    ]);
    const waves = computeWaves(
      ["req-001", "req-002", "req-003"],
      reqs,
    );
    expect(waves.length).toBe(1);
    expect(waves[0]).toEqual(["req-001", "req-002", "req-003"]);
  });

  it("respects fileOverrides when provided", () => {
    const reqs = new Map<string, Requirement>([
      [
        "req-001",
        makeReq("req-001", {
          files: { creates: [], modifies: ["src/config.ts"] },
        }),
      ],
      [
        "req-002",
        makeReq("req-002", {
          files: { creates: [], modifies: ["src/config.ts"] },
        }),
      ],
    ]);
    // Override req-002 to use a different file — no conflict anymore
    const overrides = new Map<string, RequirementFiles>([
      ["req-002", { creates: [], modifies: ["src/other.ts"] }],
    ]);
    const waves = computeWaves(["req-001", "req-002"], reqs, overrides);
    expect(waves.length).toBe(1);
    expect(waves[0]).toEqual(["req-001", "req-002"]);
  });

  it("falls back to declared files when no override exists", () => {
    const reqs = new Map<string, Requirement>([
      [
        "req-001",
        makeReq("req-001", {
          files: { creates: [], modifies: ["src/shared.ts"] },
        }),
      ],
      [
        "req-002",
        makeReq("req-002", {
          files: { creates: [], modifies: ["src/shared.ts"] },
        }),
      ],
    ]);
    // Override only req-001, req-002 falls back to declared files
    const overrides = new Map<string, RequirementFiles>([
      ["req-001", { creates: [], modifies: ["src/unique.ts"] }],
    ]);
    const waves = computeWaves(["req-001", "req-002"], reqs, overrides);
    // req-001 uses override (unique.ts), req-002 uses declared (shared.ts) — no conflict
    expect(waves.length).toBe(1);
  });
});

// ── groupStatus ──────────────────────────────────────────────────────

describe("groupStatus", () => {
  it("counts statuses correctly per group", () => {
    const index = makeIndex({
      groups: {
        core: { name: "Core", order: 1 },
        extras: { name: "Extras", order: 2 },
      },
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": { group: "core", status: "in_progress", dependsOn: [] },
        "req-003": { group: "core", status: "pending", dependsOn: [] },
        "req-004": { group: "extras", status: "discovered", dependsOn: [] },
        "req-005": { group: "extras", status: "rejected", dependsOn: [] },
      },
    });
    const gs = groupStatus(index);
    expect(gs.core.total).toBe(3);
    expect(gs.core.complete).toBe(1);
    expect(gs.core.inProgress).toBe(1);
    expect(gs.core.pending).toBe(1);
    expect(gs.core.isComplete).toBe(false);

    expect(gs.extras.total).toBe(2);
    expect(gs.extras.discovered).toBe(1);
    expect(gs.extras.rejected).toBe(1);
    // non-rejected count = 1 (discovered), which is not complete
    expect(gs.extras.isComplete).toBe(false);
  });

  it("marks group complete when all non-rejected are complete", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": { group: "core", status: "complete", dependsOn: [] },
        "req-003": { group: "core", status: "rejected", dependsOn: [] },
      },
    });
    const gs = groupStatus(index);
    expect(gs.core.isComplete).toBe(true);
    expect(gs.core.total).toBe(3);
    expect(gs.core.complete).toBe(2);
    expect(gs.core.rejected).toBe(1);
  });

  it("marks empty group as complete", () => {
    const index = makeIndex({
      groups: {
        core: { name: "Core", order: 1 },
        empty: { name: "Empty", order: 2 },
      },
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
      },
    });
    const gs = groupStatus(index);
    expect(gs.empty.isComplete).toBe(true);
    expect(gs.empty.total).toBe(0);
  });
});

// ── findDiscovered ───────────────────────────────────────────────────

describe("findDiscovered", () => {
  it("returns only discovered requirements", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": { group: "core", status: "discovered", dependsOn: [] },
        "req-003": { group: "core", status: "pending", dependsOn: [] },
        "req-004": { group: "core", status: "discovered", dependsOn: [] },
      },
    });
    const discovered = findDiscovered(index);
    expect(discovered).toEqual(["req-002", "req-004"]);
  });

  it("returns empty when no discovered requirements exist", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
      },
    });
    expect(findDiscovered(index)).toEqual([]);
  });
});

// ── isProjectComplete ────────────────────────────────────────────────

describe("isProjectComplete", () => {
  it("returns true when all non-rejected requirements are complete", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": { group: "core", status: "complete", dependsOn: [] },
        "req-003": { group: "core", status: "rejected", dependsOn: [] },
      },
    });
    expect(isProjectComplete(index)).toBe(true);
  });

  it("returns false when any pending or in_progress remain", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": { group: "core", status: "in_progress", dependsOn: [] },
      },
    });
    expect(isProjectComplete(index)).toBe(false);
  });

  it("returns true for empty requirements", () => {
    const index = makeIndex({ requirements: {} });
    expect(isProjectComplete(index)).toBe(true);
  });
});

// ── buildRequirementContext ──────────────────────────────────────────

describe("buildRequirementContext", () => {
  it("returns target + deps in topological order, skipping missing", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": {
          group: "core",
          status: "pending",
          dependsOn: ["req-001"],
        },
        "req-003": {
          group: "core",
          status: "pending",
          dependsOn: ["req-002"],
        },
      },
    });
    // Only provide req-001 and req-003 in the map — req-002 will be skipped
    const requirements = new Map<string, Requirement>([
      ["req-001", makeReq("req-001")],
      ["req-003", makeReq("req-003")],
    ]);
    const context = buildRequirementContext(index, requirements, "req-003");
    // Topological order: req-001, req-002(skipped), req-003
    expect(context.length).toBe(2);
    expect(context[0].id).toBe("req-001");
    expect(context[1].id).toBe("req-003");
  });

  it("returns all deps when all are present in the map", () => {
    const index = makeIndex({
      requirements: {
        "req-001": { group: "core", status: "complete", dependsOn: [] },
        "req-002": {
          group: "core",
          status: "pending",
          dependsOn: ["req-001"],
        },
        "req-003": {
          group: "core",
          status: "pending",
          dependsOn: ["req-002"],
        },
      },
    });
    const requirements = new Map<string, Requirement>([
      ["req-001", makeReq("req-001")],
      ["req-002", makeReq("req-002")],
      ["req-003", makeReq("req-003")],
    ]);
    const context = buildRequirementContext(index, requirements, "req-003");
    expect(context.length).toBe(3);
    expect(context.map((r) => r.id)).toEqual([
      "req-001",
      "req-002",
      "req-003",
    ]);
  });
});
