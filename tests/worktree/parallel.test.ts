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
    expect(dag.get(3)!.depth).toBe(2);
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
  });
});

// ---------------------------------------------------------------------------
// parseMilestoneDependencies
// ---------------------------------------------------------------------------

describe("parseMilestoneDependencies", () => {
  it("parses milestones without dependsOn fields (backward compatible)", () => {
    const prd = `
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

  it("returns empty array for empty PRD", () => {
    const milestones = parseMilestoneDependencies("");
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

    expect(getReadyMilestones(dag, new Set([1]))).toEqual([2]);
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
});
