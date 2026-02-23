import type { ForgeLinearClient } from "./client.js";
import type { GraphIndex, RequirementMeta } from "../graph/types.js";
import { discoverGraphs, loadIndex } from "../graph/reader.js";

/** Resolved context for a requirement: its graph index, metadata, and Linear issue identifier. */
export interface RequirementContext {
  index: GraphIndex;
  meta: RequirementMeta;
  issueIdentifier: string | null;
}

/**
 * Resolve a requirement's context from the project directory and reqId.
 *
 * Scans all graphs in `.planning/graph/` to find the requirement, then
 * optionally resolves the Linear issue identifier via the API client.
 *
 * Shared by WorktreeCreate and PreToolUse hooks.
 */
export async function resolveRequirementContext(
  projectDir: string,
  reqId: string,
  client?: ForgeLinearClient,
): Promise<RequirementContext | null> {
  const slugs = await discoverGraphs(projectDir);

  for (const slug of slugs) {
    let index: GraphIndex;
    try {
      index = await loadIndex(projectDir, slug);
    } catch {
      continue;
    }

    const meta = index.requirements[reqId];
    if (!meta) continue;

    let issueIdentifier: string | null = null;
    if (meta.linearIssueId && client) {
      try {
        const result = await client.getIssueIdentifier(meta.linearIssueId);
        if (result.success) {
          issueIdentifier = result.data;
        }
      } catch {
        // Degrade gracefully — identifier is optional
      }
    }

    return { index, meta, issueIdentifier };
  }

  return null;
}

export interface SyncResult {
  issuesTransitioned: number;
  issuesFailed: string[];
  projectUpdated: boolean;
  projectError?: string;
}

function emptySyncResult(): SyncResult {
  return { issuesTransitioned: 0, issuesFailed: [], projectUpdated: false };
}

/** Resolve + update project status, mutating result in place. */
async function transitionProject(
  client: ForgeLinearClient,
  result: SyncResult,
  projectId: string,
  category: string,
  label?: string,
): Promise<void> {
  const statusId = await client.resolveProjectStatusByCategory(category, label);
  console.log(`[forge] Updating project ${projectId} to "${label ?? category}"`);
  const r = await client.updateProjectState(projectId, statusId);
  if (r.success) {
    result.projectUpdated = true;
  } else {
    console.warn(`[forge] Failed to update project ${projectId}: ${r.error}`);
    result.projectError = r.error;
  }
}

/** Transition a single requirement's issue to "started" and project to "started". */
export async function syncRequirementStart(
  client: ForgeLinearClient,
  index: GraphIndex,
  requirementId: string,
  _branchName?: string,
): Promise<SyncResult> {
  const meta = index.requirements[requirementId];
  const result = emptySyncResult();

  if (!meta?.linearIssueId) {
    console.warn(`[forge] No linearIssueId for requirement "${requirementId}" — skipping issue transition`);
  } else {
    const teamId = index.linear?.teamId;
    if (!teamId) {
      console.warn("[forge] No Linear teamId in graph index, skipping sync");
      return result;
    }
    const issueStateId = await client.resolveIssueStateByCategory(teamId, "started", "In Progress");
    console.log(`[forge] Transitioning requirement ${requirementId} to "In Progress"`);
    const updateResult = await client.updateIssueState(meta.linearIssueId, issueStateId);
    if (updateResult.success) {
      result.issuesTransitioned = 1;
    } else {
      console.warn(`[forge] Failed to update issue: ${updateResult.error}`);
      result.issuesFailed = [meta.linearIssueId];
    }
  }

  // Also transition project to "In Progress" if not already
  if (index.linear?.projectId) {
    await transitionProject(client, result, index.linear.projectId, "started", "In Progress");
  }

  return result;
}

/** Transition project to In Review when a PR is opened (ship step). */
export async function syncGraphProjectReview(
  client: ForgeLinearClient,
  index: GraphIndex,
): Promise<SyncResult> {
  const result = emptySyncResult();

  if (index.linear?.projectId) {
    await transitionProject(client, result, index.linear.projectId, "started", "In Review");
  } else {
    console.warn("[forge] No Linear projectId in graph index, skipping review transition");
  }

  return result;
}

/** Transition project to Completed after the linked PR is merged. */
export async function syncGraphProjectCompleted(
  client: ForgeLinearClient,
  index: GraphIndex,
): Promise<SyncResult> {
  const result = emptySyncResult();

  if (index.linear?.projectId) {
    await transitionProject(client, result, index.linear.projectId, "completed");
  } else {
    console.warn("[forge] No Linear projectId in graph index, skipping completed transition");
  }

  return result;
}

/** Transition project to "Planned" after planning phase completes. */
export async function syncGraphProjectPlanned(
  client: ForgeLinearClient,
  index: GraphIndex,
): Promise<SyncResult> {
  const result = emptySyncResult();

  if (index.linear?.projectId) {
    await transitionProject(client, result, index.linear.projectId, "planned", "Planned");
  } else {
    console.warn("[forge] No Linear projectId in graph index, skipping planned transition");
  }

  return result;
}
