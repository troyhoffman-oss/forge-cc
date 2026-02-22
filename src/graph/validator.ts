import type {
  ProjectGraph,
  GraphIndex,
  Requirement,
  ValidationError,
} from "./types.js";

/**
 * Run all structural validation checks on a project graph.
 * Returns all errors found (does not short-circuit on first error).
 */
export function validateGraph(graph: ProjectGraph): ValidationError[] {
  const errors: ValidationError[] = [];

  // Dependency cycles
  const reqCycle = detectCyclesInRequirements(graph.index);
  if (reqCycle) {
    errors.push({
      type: "cycle",
      message: `Requirement dependency cycle: ${reqCycle.join(" → ")}`,
      context: { cycle: reqCycle, level: "requirement" },
    });
  }

  const groupCycle = detectCyclesInGroups(graph.index);
  if (groupCycle) {
    errors.push({
      type: "cycle",
      message: `Group dependency cycle: ${groupCycle.join(" → ")}`,
      context: { cycle: groupCycle, level: "group" },
    });
  }

  // Dangling edges
  for (const edge of findDanglingEdges(graph.index)) {
    errors.push({
      type: "dangling_dep",
      message: `${edge.level} "${edge.from}" depends on non-existent ${edge.level} "${edge.to}"`,
      context: edge,
    });
  }

  // Missing files: in index but not in requirements Map
  for (const id of Object.keys(graph.index.requirements)) {
    if (!graph.requirements.has(id)) {
      errors.push({
        type: "missing_file",
        message: `Requirement "${id}" is in the index but has no matching .md file`,
        context: { id },
      });
    }
  }

  // Orphan files: in requirements Map but not in index
  for (const id of findOrphans(graph)) {
    errors.push({
      type: "orphan_requirement",
      message: `Requirement file "${id}" exists but is not tracked in the index`,
      context: { id },
    });
  }

  // Unknown groups
  for (const [id, meta] of Object.entries(graph.index.requirements)) {
    if (!(meta.group in graph.index.groups)) {
      errors.push({
        type: "unknown_group",
        message: `Requirement "${id}" references unknown group "${meta.group}"`,
        context: { id, group: meta.group },
      });
    }
  }

  // File conflicts
  for (const conflict of findFileConflicts(graph.requirements, graph.index)) {
    errors.push({
      type: "file_conflict",
      message: `File "${conflict.file}" is touched by multiple parallelizable requirements: ${conflict.requirements.join(", ")}`,
      context: conflict,
    });
  }

  return errors;
}

/**
 * Detect cycles in the requirement and group dependency graphs.
 * Returns the cycle path if found, null if acyclic.
 */
export function detectCycles(index: GraphIndex): string[] | null {
  return detectCyclesInRequirements(index) ?? detectCyclesInGroups(index);
}

/** DFS cycle detection on the requirement dependency graph. */
function detectCyclesInRequirements(index: GraphIndex): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();

  for (const id of Object.keys(index.requirements)) {
    color.set(id, WHITE);
  }

  for (const id of Object.keys(index.requirements)) {
    if (color.get(id) === WHITE) {
      const cycle = dfsVisit(id, color, (node) => index.requirements[node]?.dependsOn ?? []);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** DFS cycle detection on the group dependency graph. */
function detectCyclesInGroups(index: GraphIndex): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();

  for (const key of Object.keys(index.groups)) {
    color.set(key, WHITE);
  }

  for (const key of Object.keys(index.groups)) {
    if (color.get(key) === WHITE) {
      const cycle = dfsVisit(key, color, (node) => index.groups[node]?.dependsOn ?? []);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Generic DFS visit with gray-node cycle detection.
 * Returns the cycle path when a back-edge is found, null otherwise.
 */
function dfsVisit(
  node: string,
  color: Map<string, number>,
  getNeighbors: (id: string) => string[],
  path: string[] = [],
): string[] | null {
  const GRAY = 1, BLACK = 2;
  color.set(node, GRAY);
  path.push(node);

  for (const neighbor of getNeighbors(node)) {
    if (color.get(neighbor) === GRAY) {
      // Found cycle — extract the cycle portion of the path
      const cycleStart = path.indexOf(neighbor);
      return [...path.slice(cycleStart), neighbor];
    }
    if (color.get(neighbor) !== BLACK && color.has(neighbor)) {
      const cycle = dfsVisit(neighbor, color, getNeighbors, path);
      if (cycle) return cycle;
    }
  }

  path.pop();
  color.set(node, BLACK);
  return null;
}

/**
 * Find all dangling dependency edges — references to IDs that don't exist.
 */
export function findDanglingEdges(
  index: GraphIndex,
): Array<{ from: string; to: string; level: "requirement" | "group" }> {
  const dangling: Array<{ from: string; to: string; level: "requirement" | "group" }> = [];

  // Requirement-level dangling edges
  for (const [id, meta] of Object.entries(index.requirements)) {
    for (const dep of meta.dependsOn) {
      if (!(dep in index.requirements)) {
        dangling.push({ from: id, to: dep, level: "requirement" });
      }
    }
  }

  // Group-level dangling edges
  for (const [key, group] of Object.entries(index.groups)) {
    for (const dep of group.dependsOn ?? []) {
      if (!(dep in index.groups)) {
        dangling.push({ from: key, to: dep, level: "group" });
      }
    }
  }

  return dangling;
}

/**
 * Find orphan requirements — files in the Map that aren't tracked in the index.
 */
export function findOrphans(graph: ProjectGraph): string[] {
  const orphans: string[] = [];
  for (const id of graph.requirements.keys()) {
    if (!(id in graph.index.requirements)) {
      orphans.push(id);
    }
  }
  return orphans;
}

/**
 * Find file conflicts — files touched by multiple requirements that could run in parallel.
 * Two requirements can run in parallel if they are in the same group and neither
 * directly depends on the other.
 */
export function findFileConflicts(
  requirements: Map<string, Requirement>,
  index: GraphIndex,
): Array<{ file: string; requirements: string[] }> {
  // Build a map of file → requirement IDs that touch it
  const fileToReqs = new Map<string, string[]>();

  for (const [id, req] of requirements) {
    // Only consider requirements that are in the index
    if (!(id in index.requirements)) continue;

    const allFiles = [...req.files.creates, ...req.files.modifies];
    for (const file of allFiles) {
      const existing = fileToReqs.get(file);
      if (existing) {
        existing.push(id);
      } else {
        fileToReqs.set(file, [id]);
      }
    }
  }

  const conflicts: Array<{ file: string; requirements: string[] }> = [];

  for (const [file, reqIds] of fileToReqs) {
    if (reqIds.length < 2) continue;

    // Filter to only those that could run in parallel:
    // same group, no direct dependency between them
    const parallelizable = findParallelizable(reqIds, index);
    if (parallelizable.length >= 2) {
      conflicts.push({ file, requirements: parallelizable });
    }
  }

  return conflicts;
}

/**
 * Given a set of requirement IDs, return those that could theoretically run in parallel.
 * Requirements can run in parallel if they share the same group and neither
 * directly depends on the other.
 */
function findParallelizable(reqIds: string[], index: GraphIndex): string[] {
  // Group requirements by their group
  const byGroup = new Map<string, string[]>();
  for (const id of reqIds) {
    const meta = index.requirements[id];
    if (!meta) continue;
    const existing = byGroup.get(meta.group);
    if (existing) {
      existing.push(id);
    } else {
      byGroup.set(meta.group, [id]);
    }
  }

  const result: string[] = [];

  for (const groupReqs of byGroup.values()) {
    if (groupReqs.length < 2) continue;

    // Build direct dependency set for fast lookup
    const depSets = new Map<string, Set<string>>();
    for (const id of groupReqs) {
      depSets.set(id, new Set(index.requirements[id]?.dependsOn ?? []));
    }

    // Find pairs that have no direct dependency
    for (const id of groupReqs) {
      let isParallel = false;
      for (const otherId of groupReqs) {
        if (id === otherId) continue;
        const idDeps = depSets.get(id)!;
        const otherDeps = depSets.get(otherId)!;
        if (!idDeps.has(otherId) && !otherDeps.has(id)) {
          isParallel = true;
          break;
        }
      }
      if (isParallel) {
        result.push(id);
      }
    }
  }

  return result;
}
