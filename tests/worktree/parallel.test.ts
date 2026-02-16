import { describe, it, expect } from "vitest";
import {
  buildDAG,
  computeExecutionWaves,
  parseMilestoneDependencies,
  getReadyMilestones,
  type MilestoneDep,
} from "../../src/worktree/parallel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dep(number: number, name: string, dependsOn: number[] = []): MilestoneDep {
  return { number, name, dependsOn };
}

// ---------------------------------------------------------------------------
// buildDAG
// ---------------------------------------------------------------------------

describe("buildDAG", () => {
  it("builds a DAG from milestones with no dependencies", () => {
    const milestones = [dep(1, "Setup"), dep(2, "Core"), dep(3, "Polish")];
    const dag = buildDAG(milestones);

    expect(dag.size).toBe(3);
    // All should be roots (depth 0) with no parents
    for (const [, node] of dag) {
      expect(node.parents).toEqual([]);
      expect(node.depth).toBe(0);
    }
  });

  it("builds a linear chain DAG", () => {
    const milestones = [
      dep(1, "First"),
      dep(2, "Second", [1]),
      dep(3, "Third", [2]),
    ];
    const dag = buildDAG(milestones);

    expect(dag.get(1)!.depth).toBe(0);
    expect(dag.get(1)!.children).toEqual([2]);

    expect(dag.get(2)!.depth).toBe(1);
    expect(dag.get(2)!.parents).toEqual([1]);
    expect(dag.get(2)!.children).toEqual([3]);

    expect(dag.get(3)!.depth).toBe(2);
    expect(dag.get(3)!.parents).toEqual([2]);
  });

  it("builds a diamond DAG", () => {
    const milestones = [
      dep(1, "Root A"),
      dep(2, "Root B"),
      dep(3, "Merge", [1, 2]),
      dep(4, "Final", [3]),
    ];
    const dag = buildDAG(milestones);

    expect(dag.get(1)!.depth).toBe(0);
    expect(dag.get(2)!.depth).toBe(0);
    expect(dag.get(3)!.depth).toBe(1);
    expect(dag.get(4)!.depth).toBe(2);
  });

  it("throws on cycle detection", () => {
    const milestones = [
      dep(1, "A", [2]),
      dep(2, "B", [1]),
    ];

    expect(() => buildDAG(milestones)).toThrow(/cycle/i);
  });

  it("throws on three-node cycle", () => {
    const milestones = [
      dep(1, "A", [3]),
      dep(2, "B", [1]),
      dep(3, "C", [2]),
    ];

    expect(() => buildDAG(milestones)).toThrow(/cycle/i);
  });

  it("throws on missing dependency", () => {
    const milestones = [
      dep(1, "First"),
      dep(2, "Second", [99]),
    ];

    expect(() => buildDAG(milestones)).toThrow(
      /milestone 2.*depends on milestone 99.*does not exist/i,
    );
  });
});

// ---------------------------------------------------------------------------
// computeExecutionWaves
// ---------------------------------------------------------------------------

describe("computeExecutionWaves", () => {
  it("returns empty result for empty DAG", () => {
    const dag = buildDAG([]);
    const result = computeExecutionWaves(dag);

    expect(result.waves).toEqual([]);
    expect(result.totalMilestones).toBe(0);
    expect(result.maxParallelism).toBe(0);
    expect(result.isSequential).toBe(true);
  });

  it("produces 3 sequential waves for linear chain M1 -> M2 -> M3", () => {
    const milestones = [
      dep(1, "First"),
      dep(2, "Second", [1]),
      dep(3, "Third", [2]),
    ];
    const dag = buildDAG(milestones);
    const result = computeExecutionWaves(dag);

    expect(result.waves).toHaveLength(3);
    expect(result.waves[0]).toEqual({ waveNumber: 1, milestones: [1] });
    expect(result.waves[1]).toEqual({ waveNumber: 2, milestones: [2] });
    expect(result.waves[2]).toEqual({ waveNumber: 3, milestones: [3] });
    expect(result.totalMilestones).toBe(3);
    expect(result.maxParallelism).toBe(1);
    expect(result.isSequential).toBe(true);
  });

  it("produces diamond waves: [1,2] -> [3] -> [4]", () => {
    const milestones = [
      dep(1, "Root A"),
      dep(2, "Root B"),
      dep(3, "Merge", [1, 2]),
      dep(4, "Final", [3]),
    ];
    const dag = buildDAG(milestones);
    const result = computeExecutionWaves(dag);

    expect(result.waves).toHaveLength(3);
    expect(result.waves[0]).toEqual({ waveNumber: 1, milestones: [1, 2] });
    expect(result.waves[1]).toEqual({ waveNumber: 2, milestones: [3] });
    expect(result.waves[2]).toEqual({ waveNumber: 3, milestones: [4] });
    expect(result.maxParallelism).toBe(2);
    expect(result.isSequential).toBe(false);
  });

  it("puts all independent milestones in wave 1 (wide parallel)", () => {
    const milestones = [
      dep(1, "Alpha"),
      dep(2, "Beta"),
      dep(3, "Gamma"),
    ];
    const dag = buildDAG(milestones);
    const result = computeExecutionWaves(dag);

    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]).toEqual({ waveNumber: 1, milestones: [1, 2, 3] });
    expect(result.maxParallelism).toBe(3);
    expect(result.isSequential).toBe(false);
  });

  it("handles complex graph with mixed dependencies", () => {
    // M1 (root), M2 (root), M3 depends on M1, M4 depends on M1+M2, M5 depends on M3+M4
    const milestones = [
      dep(1, "A"),
      dep(2, "B"),
      dep(3, "C", [1]),
      dep(4, "D", [1, 2]),
      dep(5, "E", [3, 4]),
    ];
    const dag = buildDAG(milestones);
    const result = computeExecutionWaves(dag);

    expect(result.waves).toHaveLength(3);
    // Wave 1: roots M1, M2
    expect(result.waves[0].milestones).toEqual([1, 2]);
    // Wave 2: M3 (needs M1), M4 (needs M1+M2)
    expect(result.waves[1].milestones).toEqual([3, 4]);
    // Wave 3: M5 (needs M3+M4)
    expect(result.waves[2].milestones).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
// parseMilestoneDependencies
// ---------------------------------------------------------------------------

describe("parseMilestoneDependencies", () => {
  it("parses milestones without dependsOn fields (backward compatible)", () => {
    const prd = `
# Project PRD

### Milestone 1: Setup Foundation
Build the foundation.

### Milestone 2: Core Features
Build core features.

### Milestone 3: Polish
Final polish.
`;
    const milestones = parseMilestoneDependencies(prd);

    expect(milestones).toHaveLength(3);
    expect(milestones[0]).toEqual({ number: 1, name: "Setup Foundation", dependsOn: [] });
    expect(milestones[1]).toEqual({ number: 2, name: "Core Features", dependsOn: [] });
    expect(milestones[2]).toEqual({ number: 3, name: "Polish", dependsOn: [] });
  });

  it("parses milestones with **dependsOn:** format", () => {
    const prd = `
### Milestone 1: Foundation
No dependencies here.

### Milestone 2: Features
**dependsOn:** 1

### Milestone 3: Integration
**dependsOn:** 1, 2
`;
    const milestones = parseMilestoneDependencies(prd);

    expect(milestones).toHaveLength(3);
    expect(milestones[0].dependsOn).toEqual([]);
    expect(milestones[1].dependsOn).toEqual([1]);
    expect(milestones[2].dependsOn).toEqual([1, 2]);
  });

  it("parses milestones with bracket dependsOn format", () => {
    const prd = `
### Milestone 1: Setup
dependsOn: []

### Milestone 2: Build
dependsOn: [1]

### Milestone 3: Deploy
**dependsOn:** [1, 2]
`;
    const milestones = parseMilestoneDependencies(prd);

    expect(milestones[0].dependsOn).toEqual([]);
    expect(milestones[1].dependsOn).toEqual([1]);
    expect(milestones[2].dependsOn).toEqual([1, 2]);
  });

  it("handles em-dash milestone separator", () => {
    const prd = `
### Milestone 1 \u2014 Setup Phase
Foundation work.

### Milestone 2 \u2014 Build Phase
**dependsOn:** 1
`;
    const milestones = parseMilestoneDependencies(prd);

    expect(milestones).toHaveLength(2);
    expect(milestones[0].name).toBe("Setup Phase");
    expect(milestones[1].name).toBe("Build Phase");
    expect(milestones[1].dependsOn).toEqual([1]);
  });

  it("handles dependsOn: none", () => {
    const prd = `
### Milestone 1: Setup
**dependsOn:** none
`;
    const milestones = parseMilestoneDependencies(prd);

    expect(milestones[0].dependsOn).toEqual([]);
  });

  it("returns empty array for empty PRD", () => {
    const milestones = parseMilestoneDependencies("");
    expect(milestones).toEqual([]);
  });

  it("returns empty array for PRD with no milestone headers", () => {
    const prd = `# Some Document\n\nJust text, no milestones.\n`;
    const milestones = parseMilestoneDependencies(prd);
    expect(milestones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getReadyMilestones
// ---------------------------------------------------------------------------

describe("getReadyMilestones", () => {
  it("returns all roots when nothing is completed", () => {
    const milestones = [
      dep(1, "Root A"),
      dep(2, "Root B"),
      dep(3, "Child", [1, 2]),
    ];
    const dag = buildDAG(milestones);

    const ready = getReadyMilestones(dag, new Set());
    expect(ready).toEqual([1, 2]);
  });

  it("returns dependent milestone after all parents completed", () => {
    const milestones = [
      dep(1, "Root A"),
      dep(2, "Root B"),
      dep(3, "Child", [1, 2]),
    ];
    const dag = buildDAG(milestones);

    // Only M1 completed — M3 still blocked on M2
    expect(getReadyMilestones(dag, new Set([1]))).toEqual([2]);

    // Both M1 and M2 completed — M3 now ready
    expect(getReadyMilestones(dag, new Set([1, 2]))).toEqual([3]);
  });

  it("returns empty when all milestones are completed", () => {
    const milestones = [
      dep(1, "First"),
      dep(2, "Second", [1]),
    ];
    const dag = buildDAG(milestones);

    const ready = getReadyMilestones(dag, new Set([1, 2]));
    expect(ready).toEqual([]);
  });

  it("handles partial completion in a diamond graph", () => {
    const milestones = [
      dep(1, "A"),
      dep(2, "B"),
      dep(3, "C", [1]),
      dep(4, "D", [1, 2]),
      dep(5, "E", [3, 4]),
    ];
    const dag = buildDAG(milestones);

    // Nothing completed: M1 and M2 are ready
    expect(getReadyMilestones(dag, new Set())).toEqual([1, 2]);

    // M1 completed: M2 still ready, M3 now ready (depends only on M1), M4 blocked (needs M2)
    expect(getReadyMilestones(dag, new Set([1]))).toEqual([2, 3]);

    // M1 and M2 completed: M3 and M4 ready
    expect(getReadyMilestones(dag, new Set([1, 2]))).toEqual([3, 4]);

    // M1, M2, M3 completed: M4 ready, M5 blocked (needs M4)
    expect(getReadyMilestones(dag, new Set([1, 2, 3]))).toEqual([4]);

    // M1, M2, M3, M4 completed: M5 ready
    expect(getReadyMilestones(dag, new Set([1, 2, 3, 4]))).toEqual([5]);
  });

  it("returns milestones sorted by number", () => {
    const milestones = [
      dep(5, "E"),
      dep(3, "C"),
      dep(1, "A"),
    ];
    const dag = buildDAG(milestones);

    const ready = getReadyMilestones(dag, new Set());
    expect(ready).toEqual([1, 3, 5]);
  });
});

// ---------------------------------------------------------------------------
// Integration: parseMilestoneDependencies -> buildDAG -> computeExecutionWaves
// ---------------------------------------------------------------------------

describe("end-to-end: PRD parsing to execution waves", () => {
  it("produces sequential waves for milestones with no dependsOn", () => {
    const prd = `
### Milestone 1: Setup
Foundation.

### Milestone 2: Core
Core features.

### Milestone 3: Polish
Final work.
`;
    const milestones = parseMilestoneDependencies(prd);
    const dag = buildDAG(milestones);
    const result = computeExecutionWaves(dag);

    // All milestones have no dependencies, so all in wave 1
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0].milestones).toEqual([1, 2, 3]);
    // Backward compatible: caller would process in milestone-number order
  });

  it("produces parallel waves for PRD with dependsOn fields", () => {
    const prd = `
### Milestone 1: Foundation
Base setup.

### Milestone 2: API Layer
**dependsOn:** 1
Build the API.

### Milestone 3: UI Layer
**dependsOn:** 1
Build the UI.

### Milestone 4: Integration
**dependsOn:** 2, 3
Wire API and UI together.
`;
    const milestones = parseMilestoneDependencies(prd);
    const dag = buildDAG(milestones);
    const result = computeExecutionWaves(dag);

    expect(result.waves).toHaveLength(3);
    expect(result.waves[0].milestones).toEqual([1]);
    expect(result.waves[1].milestones).toEqual([2, 3]);
    expect(result.waves[2].milestones).toEqual([4]);
    expect(result.maxParallelism).toBe(2);
    expect(result.isSequential).toBe(false);
  });
});
