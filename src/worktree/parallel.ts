/**
 * Parallel Scheduler — Milestone Dependency Analyzer & Execution Planner
 *
 * Parses `dependsOn` from PRD milestones, builds a DAG, determines which
 * milestones can run simultaneously in parallel waves, and provides
 * functions to query ready milestones given completed set.
 *
 * Backward compatible: milestones without `dependsOn` are treated as
 * having no dependencies (roots).
 */

import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MilestoneDep {
  number: number;
  name: string;
  dependsOn: number[]; // milestone numbers this depends on
}

export interface DAGNode {
  milestone: MilestoneDep;
  children: number[]; // milestones that depend on this one
  parents: number[]; // milestones this depends on (same as dependsOn)
  depth: number; // distance from root (for wave grouping)
}

export interface ExecutionWave {
  waveNumber: number;
  milestones: number[]; // milestone numbers that can run in parallel
}

export interface SchedulerResult {
  waves: ExecutionWave[];
  totalMilestones: number;
  maxParallelism: number;
  isSequential: boolean; // true if no parallelism possible (or all linear deps)
}

// ---------------------------------------------------------------------------
// buildDAG
// ---------------------------------------------------------------------------

/**
 * Build a directed acyclic graph from milestone dependencies.
 *
 * Validates:
 * - All referenced dependencies exist in the milestone set
 * - No cycles exist in the dependency graph
 *
 * Throws descriptive errors on validation failure.
 */
export function buildDAG(milestones: MilestoneDep[]): Map<number, DAGNode> {
  const dag = new Map<number, DAGNode>();
  const milestoneNumbers = new Set(milestones.map((m) => m.number));

  // Initialize all nodes
  for (const milestone of milestones) {
    dag.set(milestone.number, {
      milestone,
      children: [],
      parents: [...milestone.dependsOn],
      depth: -1, // computed later
    });
  }

  // Validate dependencies exist and build children links
  for (const milestone of milestones) {
    for (const dep of milestone.dependsOn) {
      if (!milestoneNumbers.has(dep)) {
        throw new Error(
          `Milestone ${milestone.number} ("${milestone.name}") depends on milestone ${dep}, which does not exist`,
        );
      }
      const parentNode = dag.get(dep)!;
      parentNode.children.push(milestone.number);
    }
  }

  // Detect cycles using DFS with coloring (white/gray/black)
  detectCycles(dag);

  // Compute depths via BFS from roots
  computeDepths(dag);

  return dag;
}

/**
 * Detect cycles in the DAG using DFS with three-color marking.
 * Throws an error with a descriptive message if a cycle is found.
 */
function detectCycles(dag: Map<number, DAGNode>): void {
  const WHITE = 0; // unvisited
  const GRAY = 1; // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<number, number>();
  for (const num of dag.keys()) {
    color.set(num, WHITE);
  }

  const path: number[] = [];

  function dfs(nodeNum: number): void {
    color.set(nodeNum, GRAY);
    path.push(nodeNum);

    const node = dag.get(nodeNum)!;
    for (const childNum of node.children) {
      const childColor = color.get(childNum)!;
      if (childColor === GRAY) {
        // Found a cycle — extract the cycle path for the error message
        const cycleStart = path.indexOf(childNum);
        const cyclePath = path.slice(cycleStart);
        cyclePath.push(childNum); // close the cycle
        const cycleStr = cyclePath
          .map((n) => {
            const m = dag.get(n)!.milestone;
            return `M${m.number}("${m.name}")`;
          })
          .join(" -> ");
        throw new Error(`Dependency cycle detected: ${cycleStr}`);
      }
      if (childColor === WHITE) {
        dfs(childNum);
      }
    }

    color.set(nodeNum, BLACK);
    path.pop();
  }

  for (const num of dag.keys()) {
    if (color.get(num) === WHITE) {
      dfs(num);
    }
  }
}

/**
 * Compute depth for each node via BFS from roots (nodes with no parents).
 * Depth = longest path from any root to this node.
 */
function computeDepths(dag: Map<number, DAGNode>): void {
  // Find roots (no parents)
  const roots: number[] = [];
  for (const [num, node] of dag) {
    if (node.parents.length === 0) {
      roots.push(num);
    }
  }

  // BFS-like traversal computing max depth
  // Use Kahn's algorithm approach: process nodes whose all parents are resolved
  const depth = new Map<number, number>();
  const inDegree = new Map<number, number>();

  for (const [num, node] of dag) {
    inDegree.set(num, node.parents.length);
  }

  const queue: number[] = [];
  for (const root of roots) {
    depth.set(root, 0);
    queue.push(root);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current)!;
    const node = dag.get(current)!;
    node.depth = currentDepth;

    for (const childNum of node.children) {
      const childDepth = depth.get(childNum);
      // Set child depth to max of current paths
      if (childDepth === undefined || currentDepth + 1 > childDepth) {
        depth.set(childNum, currentDepth + 1);
      }

      // Decrement in-degree; enqueue when all parents processed
      const remaining = inDegree.get(childNum)! - 1;
      inDegree.set(childNum, remaining);
      if (remaining === 0) {
        queue.push(childNum);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// computeExecutionWaves
// ---------------------------------------------------------------------------

/**
 * Topological sort milestones into parallel execution waves.
 *
 * - Wave 1: all milestones with no dependencies (roots)
 * - Wave 2: milestones whose dependencies are all in Wave 1
 * - Wave N: milestones whose dependencies are all in waves < N
 */
export function computeExecutionWaves(
  dag: Map<number, DAGNode>,
): SchedulerResult {
  if (dag.size === 0) {
    return {
      waves: [],
      totalMilestones: 0,
      maxParallelism: 0,
      isSequential: true,
    };
  }

  // Group milestones by depth — depth corresponds to wave number
  const waveMap = new Map<number, number[]>();

  for (const [num, node] of dag) {
    const d = node.depth;
    if (!waveMap.has(d)) {
      waveMap.set(d, []);
    }
    waveMap.get(d)!.push(num);
  }

  // Sort wave keys and build ExecutionWave array
  const sortedDepths = [...waveMap.keys()].sort((a, b) => a - b);
  const waves: ExecutionWave[] = sortedDepths.map((depth, index) => ({
    waveNumber: index + 1,
    milestones: waveMap.get(depth)!.sort((a, b) => a - b),
  }));

  const maxParallelism = Math.max(...waves.map((w) => w.milestones.length));
  const isSequential = maxParallelism <= 1;

  return {
    waves,
    totalMilestones: dag.size,
    maxParallelism,
    isSequential,
  };
}

// ---------------------------------------------------------------------------
// parseMilestoneDependencies
// ---------------------------------------------------------------------------

/**
 * Parse a PRD markdown document to extract milestone definitions and
 * their `dependsOn` fields.
 *
 * Looks for milestone headers like:
 *   ### Milestone 1: Name Here
 *   ### Milestone 2 — Name Here
 *
 * And within each milestone section, looks for:
 *   **dependsOn:** 1, 3
 *   dependsOn: [1, 3]
 *   **dependsOn:** [1]
 *
 * If no `dependsOn` field is found, treats the milestone as having no
 * dependencies (backward compatible).
 */
export function parseMilestoneDependencies(prdContent: string): MilestoneDep[] {
  const milestones: MilestoneDep[] = [];

  // Split PRD into milestone sections
  // Match headers like: ### Milestone 1: Name or ### Milestone 1 — Name
  const milestoneHeaderRe =
    /###\s*Milestone\s+(\d+)\s*[:\—–-]\s*(.+)/g;

  const headers: Array<{ number: number; name: string; index: number }> = [];
  let headerMatch: RegExpExecArray | null;
  while ((headerMatch = milestoneHeaderRe.exec(prdContent)) !== null) {
    headers.push({
      number: parseInt(headerMatch[1], 10),
      name: headerMatch[2].trim(),
      index: headerMatch.index,
    });
  }

  // Extract section content for each milestone
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const sectionStart = header.index;
    const sectionEnd =
      i + 1 < headers.length ? headers[i + 1].index : prdContent.length;
    const sectionContent = prdContent.slice(sectionStart, sectionEnd);

    // Look for dependsOn field in the section
    const dependsOn = parseDependsOnField(sectionContent);

    milestones.push({
      number: header.number,
      name: header.name,
      dependsOn,
    });
  }

  return milestones;
}

/**
 * Parse the dependsOn field from a milestone section.
 * Supports formats:
 *   **dependsOn:** 1, 3
 *   dependsOn: [1, 3]
 *   **dependsOn:** [1]
 *   **dependsOn:** none
 *
 * Returns empty array if not found or explicitly "none".
 */
function parseDependsOnField(sectionContent: string): number[] {
  // Match patterns like:
  //   **dependsOn:** 1, 3      (bold markdown: ** before key, :** after)
  //   dependsOn: [1, 3]        (plain text)
  //   **dependsOn:** [1]       (bold with brackets)
  const dependsOnRe =
    /\*{0,2}dependsOn:\*{0,2}\s*(.+)/i;
  const match = sectionContent.match(dependsOnRe);

  if (!match) {
    return [];
  }

  const value = match[1].trim();

  // Handle "none" or empty
  if (
    value.toLowerCase() === "none" ||
    value === "[]" ||
    value === "" ||
    value === "-"
  ) {
    return [];
  }

  // Strip brackets if present: [1, 3] -> 1, 3
  const stripped = value.replace(/^\[/, "").replace(/\].*$/, "");

  // Parse comma-separated numbers
  const numbers: number[] = [];
  for (const part of stripped.split(",")) {
    const trimmed = part.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num)) {
      numbers.push(num);
    }
  }

  return numbers;
}

// ---------------------------------------------------------------------------
// getReadyMilestones
// ---------------------------------------------------------------------------

/**
 * Given execution waves and a set of completed milestone numbers,
 * return which milestones are ready to start.
 *
 * A milestone is ready if:
 * 1. It has not been completed yet
 * 2. All of its dependencies (from the wave schedule) are in the completed set
 *
 * This requires the original DAG to check dependencies, so we accept
 * the waves plus the DAG.
 */
export function getReadyMilestones(
  dag: Map<number, DAGNode>,
  completed: Set<number>,
): number[] {
  const ready: number[] = [];

  for (const [num, node] of dag) {
    // Skip already completed
    if (completed.has(num)) {
      continue;
    }

    // Check if all parents are completed
    const allParentsCompleted = node.parents.every((p) => completed.has(p));
    if (allParentsCompleted) {
      ready.push(num);
    }
  }

  return ready.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// buildScheduleFromPRD — convenience function
// ---------------------------------------------------------------------------

/**
 * Parse a PRD file and build the full execution schedule.
 * Combines parseMilestoneDependencies + buildDAG + computeExecutionWaves.
 *
 * If the PRD has no `dependsOn` fields, all milestones will be in wave 1
 * (all roots), which is backward compatible with sequential execution
 * when the caller processes them in milestone-number order.
 */
export async function buildScheduleFromPRD(
  prdPath: string,
): Promise<SchedulerResult> {
  const prdContent = await readFile(prdPath, "utf-8");
  const milestones = parseMilestoneDependencies(prdContent);

  if (milestones.length === 0) {
    return {
      waves: [],
      totalMilestones: 0,
      maxParallelism: 0,
      isSequential: true,
    };
  }

  const dag = buildDAG(milestones);
  return computeExecutionWaves(dag);
}
