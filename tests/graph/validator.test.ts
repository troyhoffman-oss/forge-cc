import { describe, it, expect } from "vitest";
import type {
  GraphIndex,
  ProjectGraph,
  Requirement,
} from "../../src/graph/types.js";
import {
  validateGraph,
  detectCycles,
  findDanglingEdges,
  findOrphans,
  findFileConflicts,
} from "../../src/graph/validator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidGraph(): ProjectGraph {
  const index: GraphIndex = {
    project: "Valid",
    slug: "valid",
    branch: "feat/valid",
    createdAt: "2026-01-01",
    groups: { core: { name: "Core" } },
    requirements: {
      "req-001": { group: "core", status: "complete", dependsOn: [] },
      "req-002": {
        group: "core",
        status: "pending",
        dependsOn: ["req-001"],
      },
    },
  };
  const requirements = new Map<string, Requirement>([
    [
      "req-001",
      {
        id: "req-001",
        title: "First",
        files: { creates: [], modifies: [] },
        acceptance: ["done"],
        body: "",
      },
    ],
    [
      "req-002",
      {
        id: "req-002",
        title: "Second",
        files: { creates: [], modifies: [] },
        acceptance: ["done"],
        body: "",
      },
    ],
  ]);
  return { index, overview: "Test project", requirements };
}

function makeIndex(
  overrides: Partial<GraphIndex> = {},
): GraphIndex {
  return {
    project: "Test",
    slug: "test",
    branch: "feat/test",
    createdAt: "2026-01-01",
    groups: { core: { name: "Core" } },
    requirements: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("graph validator", () => {
  // 1. validateGraph returns empty array for a valid graph
  describe("validateGraph", () => {
    it("returns empty array for a valid graph", () => {
      const graph = makeValidGraph();
      const errors = validateGraph(graph);
      expect(errors).toEqual([]);
    });

    // 9. validateGraph catches all error types simultaneously
    it("catches all error types simultaneously on an invalid graph", () => {
      const index: GraphIndex = {
        project: "Invalid",
        slug: "invalid",
        branch: "feat/invalid",
        createdAt: "2026-01-01",
        groups: { core: { name: "Core" } },
        requirements: {
          "req-001": {
            group: "core",
            status: "pending",
            dependsOn: ["req-003", "req-999"],
          },
          "req-002": {
            group: "core",
            status: "pending",
            dependsOn: ["req-001"],
          },
          "req-003": {
            group: "nonexistent",
            status: "pending",
            dependsOn: ["req-002"],
          },
        },
      };

      const requirements = new Map<string, Requirement>([
        [
          "req-001",
          {
            id: "req-001",
            title: "R1",
            files: { creates: [], modifies: [] },
            acceptance: ["ok"],
            body: "",
          },
        ],
        [
          "req-002",
          {
            id: "req-002",
            title: "R2",
            files: { creates: [], modifies: [] },
            acceptance: ["ok"],
            body: "",
          },
        ],
        [
          "req-003",
          {
            id: "req-003",
            title: "R3",
            files: { creates: [], modifies: [] },
            acceptance: ["ok"],
            body: "",
          },
        ],
        // Orphan — in the Map but not in the index
        [
          "orphan-001",
          {
            id: "orphan-001",
            title: "Orphan",
            files: { creates: [], modifies: [] },
            acceptance: ["ok"],
            body: "",
          },
        ],
      ]);

      const graph: ProjectGraph = {
        index,
        overview: "Invalid project",
        requirements,
      };

      const errors = validateGraph(graph);
      const types = errors.map((e) => e.type);

      // Cycle: req-001 → req-003 → req-002 → req-001
      expect(types).toContain("cycle");
      // Dangling: req-001 depends on req-999 which doesn't exist
      expect(types).toContain("dangling_dep");
      // Orphan: orphan-001 not in index
      expect(types).toContain("orphan_requirement");
      // Unknown group: req-003 references "nonexistent"
      expect(types).toContain("unknown_group");
      // At least 4 distinct error types
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBeGreaterThanOrEqual(4);
    });
  });

  // 2. detectCycles finds requirement-level cycle (A→B→C→A)
  describe("detectCycles", () => {
    it("finds requirement-level cycle (A→B→C→A)", () => {
      const index = makeIndex({
        requirements: {
          a: { group: "core", status: "pending", dependsOn: ["c"] },
          b: { group: "core", status: "pending", dependsOn: ["a"] },
          c: { group: "core", status: "pending", dependsOn: ["b"] },
        },
      });

      const cycle = detectCycles(index);
      expect(cycle).not.toBeNull();
      // Cycle should end with the same node it starts with
      expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
      // All three nodes should be in the cycle
      expect(cycle).toContain("a");
      expect(cycle).toContain("b");
      expect(cycle).toContain("c");
    });

    // 3. detectCycles finds group-level cycle
    it("finds group-level cycle (groupA→groupB→groupA)", () => {
      const index = makeIndex({
        groups: {
          groupA: { name: "Group A", dependsOn: ["groupB"] },
          groupB: { name: "Group B", dependsOn: ["groupA"] },
        },
        requirements: {},
      });

      const cycle = detectCycles(index);
      expect(cycle).not.toBeNull();
      expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
      expect(cycle).toContain("groupA");
      expect(cycle).toContain("groupB");
    });

    // 4. detectCycles returns null for acyclic graph
    it("returns null for acyclic graph", () => {
      const index = makeIndex({
        groups: {
          foundation: { name: "Foundation" },
          features: { name: "Features", dependsOn: ["foundation"] },
        },
        requirements: {
          "r-1": { group: "foundation", status: "complete", dependsOn: [] },
          "r-2": {
            group: "features",
            status: "pending",
            dependsOn: ["r-1"],
          },
          "r-3": {
            group: "features",
            status: "pending",
            dependsOn: ["r-1"],
          },
        },
      });

      const cycle = detectCycles(index);
      expect(cycle).toBeNull();
    });

    it("prioritizes requirement cycles over group cycles", () => {
      const index = makeIndex({
        groups: {
          g1: { name: "G1", dependsOn: ["g2"] },
          g2: { name: "G2", dependsOn: ["g1"] },
        },
        requirements: {
          a: { group: "g1", status: "pending", dependsOn: ["b"] },
          b: { group: "g1", status: "pending", dependsOn: ["a"] },
        },
      });

      const cycle = detectCycles(index);
      expect(cycle).not.toBeNull();
      // Should be a requirement cycle (a, b) not a group cycle (g1, g2)
      expect(cycle).toContain("a");
      expect(cycle).toContain("b");
    });
  });

  // 5. findDanglingEdges finds missing requirement references
  describe("findDanglingEdges", () => {
    it("finds missing requirement references", () => {
      const index = makeIndex({
        requirements: {
          "r-1": {
            group: "core",
            status: "pending",
            dependsOn: ["r-nonexistent"],
          },
        },
      });

      const dangling = findDanglingEdges(index);
      expect(dangling).toHaveLength(1);
      expect(dangling[0]).toEqual({
        from: "r-1",
        to: "r-nonexistent",
        level: "requirement",
      });
    });

    // 6. findDanglingEdges finds missing group references
    it("finds missing group references", () => {
      const index = makeIndex({
        groups: {
          core: { name: "Core", dependsOn: ["missing-group"] },
        },
      });

      const dangling = findDanglingEdges(index);
      expect(dangling).toHaveLength(1);
      expect(dangling[0]).toEqual({
        from: "core",
        to: "missing-group",
        level: "group",
      });
    });

    it("returns empty array when all edges are valid", () => {
      const index = makeIndex({
        groups: {
          foundation: { name: "Foundation" },
          features: { name: "Features", dependsOn: ["foundation"] },
        },
        requirements: {
          "r-1": { group: "foundation", status: "complete", dependsOn: [] },
          "r-2": {
            group: "features",
            status: "pending",
            dependsOn: ["r-1"],
          },
        },
      });

      const dangling = findDanglingEdges(index);
      expect(dangling).toHaveLength(0);
    });
  });

  // 7. findOrphans finds requirement files not tracked in the index
  describe("findOrphans", () => {
    it("finds requirement files not tracked in the index", () => {
      const graph = makeValidGraph();
      // Add an orphan to the requirements Map
      graph.requirements.set("orphan-001", {
        id: "orphan-001",
        title: "Orphan",
        files: { creates: [], modifies: [] },
        acceptance: ["ok"],
        body: "",
      });

      const orphans = findOrphans(graph);
      expect(orphans).toEqual(["orphan-001"]);
    });

    it("returns empty array when all requirements are tracked", () => {
      const graph = makeValidGraph();
      const orphans = findOrphans(graph);
      expect(orphans).toEqual([]);
    });
  });

  // 8. findFileConflicts finds shared files between parallel requirements
  describe("findFileConflicts", () => {
    it("finds shared files between parallel requirements", () => {
      const index = makeIndex({
        requirements: {
          r1: { group: "core", status: "pending", dependsOn: [] },
          r2: { group: "core", status: "pending", dependsOn: [] },
        },
      });

      const requirements = new Map<string, Requirement>([
        [
          "r1",
          {
            id: "r1",
            title: "R1",
            files: { creates: [], modifies: ["shared.ts"] },
            acceptance: ["x"],
            body: "",
          },
        ],
        [
          "r2",
          {
            id: "r2",
            title: "R2",
            files: { creates: [], modifies: ["shared.ts"] },
            acceptance: ["x"],
            body: "",
          },
        ],
      ]);

      const conflicts = findFileConflicts(requirements, index);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file).toBe("shared.ts");
      expect(conflicts[0].requirements).toContain("r1");
      expect(conflicts[0].requirements).toContain("r2");
    });

    it("does not report conflict when requirements have a direct dependency", () => {
      const index = makeIndex({
        requirements: {
          r1: { group: "core", status: "pending", dependsOn: [] },
          r2: { group: "core", status: "pending", dependsOn: ["r1"] },
        },
      });

      const requirements = new Map<string, Requirement>([
        [
          "r1",
          {
            id: "r1",
            title: "R1",
            files: { creates: [], modifies: ["shared.ts"] },
            acceptance: ["x"],
            body: "",
          },
        ],
        [
          "r2",
          {
            id: "r2",
            title: "R2",
            files: { creates: [], modifies: ["shared.ts"] },
            acceptance: ["x"],
            body: "",
          },
        ],
      ]);

      const conflicts = findFileConflicts(requirements, index);
      expect(conflicts).toHaveLength(0);
    });

    it("does not report conflict for requirements in different groups", () => {
      const index = makeIndex({
        groups: {
          core: { name: "Core" },
          extra: { name: "Extra" },
        },
        requirements: {
          r1: { group: "core", status: "pending", dependsOn: [] },
          r2: { group: "extra", status: "pending", dependsOn: [] },
        },
      });

      const requirements = new Map<string, Requirement>([
        [
          "r1",
          {
            id: "r1",
            title: "R1",
            files: { creates: ["overlap.ts"], modifies: [] },
            acceptance: ["x"],
            body: "",
          },
        ],
        [
          "r2",
          {
            id: "r2",
            title: "R2",
            files: { creates: ["overlap.ts"], modifies: [] },
            acceptance: ["x"],
            body: "",
          },
        ],
      ]);

      const conflicts = findFileConflicts(requirements, index);
      expect(conflicts).toHaveLength(0);
    });

    it("returns empty array when no files overlap", () => {
      const index = makeIndex({
        requirements: {
          r1: { group: "core", status: "pending", dependsOn: [] },
          r2: { group: "core", status: "pending", dependsOn: [] },
        },
      });

      const requirements = new Map<string, Requirement>([
        [
          "r1",
          {
            id: "r1",
            title: "R1",
            files: { creates: ["a.ts"], modifies: [] },
            acceptance: ["x"],
            body: "",
          },
        ],
        [
          "r2",
          {
            id: "r2",
            title: "R2",
            files: { creates: ["b.ts"], modifies: [] },
            acceptance: ["x"],
            body: "",
          },
        ],
      ]);

      const conflicts = findFileConflicts(requirements, index);
      expect(conflicts).toHaveLength(0);
    });
  });
});
