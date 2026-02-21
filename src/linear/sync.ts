import type { PRDStatus } from "../types.js";
import type { ForgeLinearClient } from "./client.js";

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

/**
 * Transition milestone issues to "started" and project to "started".
 */
export async function syncMilestoneStart(
  client: ForgeLinearClient,
  status: PRDStatus,
  milestone: string,
): Promise<SyncResult> {
  const ms = status.milestones[milestone];
  if (!ms) {
    console.warn(`[forge] Milestone "${milestone}" not found in status file`);
    return emptySyncResult();
  }

  const teamId = status.linearTeamId;
  if (!teamId) {
    console.warn("[forge] No linearTeamId in status file, skipping sync");
    return emptySyncResult();
  }

  const issueStateId = await client.resolveIssueStateByCategory(teamId, "started", "In Progress");
  const result = emptySyncResult();

  const issueIds = ms.linearIssueIds ?? [];
  if (issueIds.length === 0) {
    console.warn(`[forge] No linearIssueIds for milestone "${milestone}" — skipping issue transitions`);
  } else {
    console.log(`[forge] Transitioning ${issueIds.length} issue(s) to "In Progress"`);
    const batchResult = await client.updateIssueBatch(issueIds, { stateId: issueStateId });
    if (batchResult.success) {
      result.issuesTransitioned = batchResult.data.updated;
      result.issuesFailed = batchResult.data.failed;
    } else {
      console.warn(`[forge] Batch update failed: ${batchResult.error}`);
      result.issuesFailed = issueIds;
    }
  }

  if (status.linearProjectId) {
    await transitionProject(client, result, status.linearProjectId, "started", "In Progress");
  }

  return result;
}

/**
 * No-op — issues are left for PR automation (PR open -> In Review, PR merge -> Completed).
 */
export async function syncMilestoneComplete(
  milestone: string,
): Promise<SyncResult> {
  console.log(`[forge] Milestone "${milestone}" complete — issues left for PR automation`);
  return emptySyncResult();
}

/**
 * Transition all issues across all milestones to "completed" (safety net) and project to "completed".
 */
export async function syncProjectDone(
  client: ForgeLinearClient,
  status: PRDStatus,
): Promise<SyncResult> {
  const teamId = status.linearTeamId;
  if (!teamId) {
    console.warn("[forge] No linearTeamId in status file, skipping sync");
    return emptySyncResult();
  }

  const doneStateId = await client.resolveIssueStateByCategory(teamId, "completed");
  const result = emptySyncResult();

  const allIssueIds: string[] = [];
  for (const [name, ms] of Object.entries(status.milestones)) {
    const ids = ms.linearIssueIds ?? [];
    if (ids.length === 0) {
      console.warn(`[forge] No linearIssueIds for milestone "${name}" — skipping issue transitions`);
    } else {
      allIssueIds.push(...ids);
    }
  }

  if (allIssueIds.length > 0) {
    console.log(`[forge] Transitioning ${allIssueIds.length} issue(s) across all milestones to "Done"`);
    const batchResult = await client.updateIssueBatch(allIssueIds, { stateId: doneStateId });
    if (batchResult.success) {
      result.issuesTransitioned = batchResult.data.updated;
      result.issuesFailed = batchResult.data.failed;
    } else {
      console.warn(`[forge] Batch update failed: ${batchResult.error}`);
      result.issuesFailed = allIssueIds;
    }
  } else {
    console.log(`[forge] Transitioned 0 issue(s) across all milestones to "Done"`);
  }

  if (status.linearProjectId) {
    await transitionProject(client, result, status.linearProjectId, "completed", "Done");
  }

  return result;
}

/**
 * Promote project from Backlog to Planned (no-op if already beyond backlog).
 */
export async function syncProjectPlanned(
  client: ForgeLinearClient,
  status: PRDStatus,
): Promise<SyncResult> {
  const result = emptySyncResult();
  const projectId = status.linearProjectId;
  if (!projectId) {
    console.warn("[forge] No linearProjectId in status file, skipping sync");
    return result;
  }

  const currentCategory = await client.getProjectStatusCategory(projectId);
  if (currentCategory && currentCategory !== "backlog") {
    console.log(`[forge] Project already at "${currentCategory}" — skipping planned transition`);
    return result;
  }

  await transitionProject(client, result, projectId, "planned", "Planned");
  return result;
}
