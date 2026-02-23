import type { ForgeLinearClient } from "./client.js";
import type { GraphIndex } from "../graph/types.js";

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
  label: string,
): Promise<void> {
  const statusId = await client.resolveProjectStatusByCategory(category, label);
  console.log(`[forge] Updating project ${projectId} to "${label}"`);
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
  branchName?: string,
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

  // Attach branch to issue if both are available
  if (meta?.linearIssueId && branchName) {
    const attachResult = await client.attachIssueBranch(meta.linearIssueId, branchName);
    if (attachResult.success) {
      console.log(`[forge] Attached branch "${branchName}" to issue ${requirementId}`);
    } else {
      console.warn(`[forge] Failed to attach branch to issue ${requirementId}: ${attachResult.error}`);
    }
  }

  // Also transition project to "In Progress" if not already
  if (index.linear?.projectId) {
    await transitionProject(client, result, index.linear.projectId, "started", "In Progress");
  }

  return result;
}

/** Transition project to In Review when all requirements are complete. Issues are not touched — Linear's GitHub automation handles issue transitions via PR linking. */
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
