import type {
  GraphIndex,
  Requirement,
  RequirementFiles,
  GroupStatus,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Check if every non-rejected requirement in a group is "complete". */
function isGroupComplete(
  index: GraphIndex,
  groupKey: string,
): boolean {
  for (const meta of Object.values(index.requirements)) {
    if (meta.group !== groupKey) continue;
    if (meta.status === "rejected") continue;
    if (meta.status !== "complete") return false;
  }
  return true;
}

/** Topological sort of group keys using their dependsOn edges. */
function topoSortGroups(index: GraphIndex): string[] {
  const keys = Object.keys(index.groups);
  const visited = new Set<string>();
  const sorted: string[] = [];
  const visiting = new Set<string>();

  function visit(key: string): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) return; // cycle — skip gracefully
    visiting.add(key);
    const deps = index.groups[key]?.dependsOn ?? [];
    for (const dep of deps) {
      if (index.groups[dep]) visit(dep);
    }
    visiting.delete(key);
    visited.add(key);
    sorted.push(key);
  }

  // Sort keys by order field (ascending), then alphabetically for stability
  const orderedKeys = [...keys].sort((a, b) => {
    const oa = index.groups[a].order ?? Infinity;
    const ob = index.groups[b].order ?? Infinity;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  for (const key of orderedKeys) {
    visit(key);
  }

  return sorted;
}

/** Build a map from group key to its topological position. */
function groupOrderMap(index: GraphIndex): Map<string, number> {
  const sorted = topoSortGroups(index);
  const map = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    map.set(sorted[i], i);
  }
  return map;
}

/** Check if all group-level dependsOn are fully complete for a requirement's group. */
function areGroupDepsComplete(
  index: GraphIndex,
  groupKey: string,
): boolean {
  const groupDef = index.groups[groupKey];
  if (!groupDef?.dependsOn?.length) return true;
  for (const depGroup of groupDef.dependsOn) {
    if (!isGroupComplete(index, depGroup)) return false;
  }
  return true;
}

/** Get group-level blocker group keys for a requirement's group. */
function getGroupBlockers(
  index: GraphIndex,
  groupKey: string,
): string[] {
  const groupDef = index.groups[groupKey];
  if (!groupDef?.dependsOn?.length) return [];
  const blockers: string[] = [];
  for (const depGroup of groupDef.dependsOn) {
    if (!isGroupComplete(index, depGroup)) {
      blockers.push(depGroup);
    }
  }
  return blockers;
}

// ── Query Functions ──────────────────────────────────────────────────

/**
 * Returns requirement IDs that are ready to start:
 * - status === "pending"
 * - all requirement-level dependsOn are "complete"
 * - all group-level dependsOn groups are fully complete
 *
 * Sorted by: priority desc, group order (topo), insertion order within group.
 */
export function findReady(index: GraphIndex): string[] {
  const gOrder = groupOrderMap(index);
  const reqEntries = Object.entries(index.requirements);
  const ready: string[] = [];

  for (const [id, meta] of reqEntries) {
    if (meta.status !== "pending") continue;

    // Check requirement-level deps
    const allReqDepsComplete = meta.dependsOn.every((depId) => {
      const depMeta = index.requirements[depId];
      return depMeta?.status === "complete";
    });
    if (!allReqDepsComplete) continue;

    // Check group-level deps
    if (!areGroupDepsComplete(index, meta.group)) continue;

    ready.push(id);
  }

  // Sort: priority desc, then group order asc, then insertion order (stable)
  const insertionOrder = new Map<string, number>();
  reqEntries.forEach(([id], i) => insertionOrder.set(id, i));

  ready.sort((a, b) => {
    const metaA = index.requirements[a];
    const metaB = index.requirements[b];

    // Priority descending (higher first)
    const pa = metaA.priority ?? 0;
    const pb = metaB.priority ?? 0;
    if (pa !== pb) return pb - pa;

    // Group order ascending
    const ga = gOrder.get(metaA.group) ?? Infinity;
    const gb = gOrder.get(metaB.group) ?? Infinity;
    if (ga !== gb) return ga - gb;

    // Insertion order (original order in index)
    return (insertionOrder.get(a) ?? 0) - (insertionOrder.get(b) ?? 0);
  });

  return ready;
}

/**
 * Returns pending requirements where at least one dependsOn is NOT "complete"
 * or group-level deps are not met. Includes both requirement-level and group-level blockers.
 */
export function findBlocked(
  index: GraphIndex,
): Array<{ id: string; blockedBy: string[] }> {
  const result: Array<{ id: string; blockedBy: string[] }> = [];

  for (const [id, meta] of Object.entries(index.requirements)) {
    if (meta.status !== "pending") continue;

    const blockers: string[] = [];

    // Requirement-level blockers
    for (const depId of meta.dependsOn) {
      const depMeta = index.requirements[depId];
      if (!depMeta || depMeta.status !== "complete") {
        blockers.push(depId);
      }
    }

    // Group-level blockers
    const groupBlockers = getGroupBlockers(index, meta.group);
    for (const gb of groupBlockers) {
      blockers.push(`group:${gb}`);
    }

    if (blockers.length > 0) {
      result.push({ id, blockedBy: blockers });
    }
  }

  return result;
}

/**
 * DFS traversal of dependsOn graph. Returns IDs in topological order
 * (dependencies first, target last). Throws on cycle detection.
 */
export function getTransitiveDeps(
  index: GraphIndex,
  id: string,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(currentId: string): void {
    if (visited.has(currentId)) return;
    if (visiting.has(currentId)) {
      throw new Error(
        `Cycle detected: ${currentId} is part of a dependency cycle`,
      );
    }

    visiting.add(currentId);
    const meta = index.requirements[currentId];
    if (meta) {
      for (const depId of meta.dependsOn) {
        visit(depId);
      }
    }
    visiting.delete(currentId);
    visited.add(currentId);
    result.push(currentId);
  }

  visit(id);
  return result;
}

/**
 * Group ready requirements into parallel waves. Two requirements cannot
 * share a wave if they have overlapping files (creates or modifies).
 *
 * Uses fileOverrides if provided for a given ID, otherwise falls back to
 * the requirement's files field.
 *
 * Algorithm: greedy — for each requirement in order, assign to first wave
 * with no file conflicts. If none, create new wave.
 */
export function computeWaves(
  readyIds: string[],
  requirements: Map<string, Requirement>,
  fileOverrides?: Map<string, RequirementFiles>,
): string[][] {
  const waves: string[][] = [];
  const waveFiles: Set<string>[] = [];

  function getFiles(id: string): string[] {
    const override = fileOverrides?.get(id);
    if (override) {
      return [...override.creates, ...override.modifies];
    }
    const req = requirements.get(id);
    if (!req) return [];
    return [...req.files.creates, ...req.files.modifies];
  }

  for (const id of readyIds) {
    const files = getFiles(id);
    let assigned = false;

    for (let w = 0; w < waves.length; w++) {
      const hasConflict = files.some((f) => waveFiles[w].has(f));
      if (!hasConflict) {
        waves[w].push(id);
        for (const f of files) waveFiles[w].add(f);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      waves.push([id]);
      waveFiles.push(new Set(files));
    }
  }

  return waves;
}

/**
 * Count requirements by status per group. `isComplete` = every non-rejected
 * requirement is "complete".
 */
export function groupStatus(
  index: GraphIndex,
): Record<string, GroupStatus> {
  const result: Record<string, GroupStatus> = {};

  // Initialize all groups
  for (const groupKey of Object.keys(index.groups)) {
    result[groupKey] = {
      total: 0,
      complete: 0,
      inProgress: 0,
      pending: 0,
      discovered: 0,
      rejected: 0,
      isComplete: true,
    };
  }

  // Count requirements per group
  for (const meta of Object.values(index.requirements)) {
    const gs = result[meta.group];
    if (!gs) continue;

    gs.total++;
    switch (meta.status) {
      case "complete":
        gs.complete++;
        break;
      case "in_progress":
        gs.inProgress++;
        break;
      case "pending":
        gs.pending++;
        break;
      case "discovered":
        gs.discovered++;
        break;
      case "rejected":
        gs.rejected++;
        break;
    }
  }

  // Compute isComplete: every non-rejected requirement is "complete"
  for (const groupKey of Object.keys(result)) {
    const gs = result[groupKey];
    const nonRejected = gs.total - gs.rejected;
    gs.isComplete = nonRejected > 0
      ? gs.complete === nonRejected
      : true; // empty group is complete
  }

  return result;
}

/**
 * Return IDs where status === "discovered".
 */
export function findDiscovered(index: GraphIndex): string[] {
  const result: string[] = [];
  for (const [id, meta] of Object.entries(index.requirements)) {
    if (meta.status === "discovered") {
      result.push(id);
    }
  }
  return result;
}

/**
 * True when every requirement with status other than "rejected" has status "complete".
 */
export function isProjectComplete(index: GraphIndex): boolean {
  for (const meta of Object.values(index.requirements)) {
    if (meta.status === "rejected") continue;
    if (meta.status !== "complete") return false;
  }
  return true;
}

/**
 * Get the target requirement + all transitive deps. Return in topological order
 * (deps first, target last). Skips IDs not found in the requirements Map.
 */
export function buildRequirementContext(
  index: GraphIndex,
  requirements: Map<string, Requirement>,
  targetId: string,
): Requirement[] {
  const depIds = getTransitiveDeps(index, targetId);
  const result: Requirement[] = [];
  for (const depId of depIds) {
    const req = requirements.get(depId);
    if (req) result.push(req);
  }
  return result;
}
