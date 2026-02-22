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
  const statusId = await client.resolveProjectStatusByCategory(category);
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

/** Transition all graph requirements' issues to "completed" and project to "completed". */
export async function syncGraphProjectDone(
  client: ForgeLinearClient,
  index: GraphIndex,
): Promise<SyncResult> {
  const teamId = index.linear?.teamId;
  if (!teamId) {
    console.warn("[forge] No Linear teamId in graph index, skipping sync");
    return emptySyncResult();
  }

  const doneStateId = await client.resolveIssueStateByCategory(teamId, "completed");
  const result = emptySyncResult();

  const allIssueIds: string[] = [];
  for (const [id, meta] of Object.entries(index.requirements)) {
    if (meta.linearIssueId) {
      allIssueIds.push(meta.linearIssueId);
    } else {
      console.warn(`[forge] No linearIssueId for requirement "${id}" — skipping`);
    }
  }

  if (allIssueIds.length > 0) {
    console.log(`[forge] Transitioning ${allIssueIds.length} issue(s) to "Done"`);
    const batchResult = await client.updateIssueBatch(allIssueIds, { stateId: doneStateId });
    if (batchResult.success) {
      result.issuesTransitioned = batchResult.data.updated;
      result.issuesFailed = batchResult.data.failed;
    } else {
      console.warn(`[forge] Batch update failed: ${batchResult.error}`);
      result.issuesFailed = allIssueIds;
    }
  }

  if (index.linear?.projectId) {
    await transitionProject(client, result, index.linear.projectId, "completed", "Done");
  }

  return result;
}
