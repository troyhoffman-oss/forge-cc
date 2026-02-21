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

  // Transition milestone issues to In Progress
  const issueIds = ms.linearIssueIds ?? [];
  if (issueIds.length === 0) {
    console.warn(
      `[forge] No linearIssueIds for milestone "${milestone}" — skipping issue transitions`,
    );
  } else {
    console.log(
      `[forge] Transitioning ${issueIds.length} issue(s) to "In Progress"`,
    );
    const batchResult = await client.updateIssueBatch(issueIds, { stateId: issueStateId });
    if (batchResult.success) {
      result.issuesTransitioned = batchResult.data.updated;
      result.issuesFailed = batchResult.data.failed;
    } else {
      console.warn(`[forge] Batch update failed: ${batchResult.error}`);
      result.issuesFailed = issueIds;
    }
  }

  // Transition project to In Progress
  const projectId = status.linearProjectId;
  if (projectId) {
    const projectStatusId = await client.resolveProjectStatusByCategory("started");
    console.log(
      `[forge] Updating project ${projectId} to "In Progress"`,
    );
    const projectResult = await client.updateProjectState(projectId, projectStatusId);
    if (projectResult.success) {
      result.projectUpdated = true;
    } else {
      console.warn(`[forge] Failed to update project ${projectId}: ${projectResult.error}`);
      result.projectError = projectResult.error;
    }
  }

  return result;
}

/**
 * Milestone complete — issues are left for PR automation (PR open -> In Review, PR merge -> Completed).
 * This is now a no-op for both issues and project.
 */
export async function syncMilestoneComplete(
  _client: ForgeLinearClient,
  _status: PRDStatus,
  milestone: string,
  _isLast: boolean,
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

  // Collect all issue IDs across all milestones for a single batch call
  const allIssueIds: string[] = [];
  for (const [name, ms] of Object.entries(status.milestones)) {
    const issueIds = ms.linearIssueIds ?? [];
    if (issueIds.length === 0) {
      console.warn(
        `[forge] No linearIssueIds for milestone "${name}" — skipping issue transitions`,
      );
      continue;
    }
    allIssueIds.push(...issueIds);
  }

  if (allIssueIds.length > 0) {
    console.log(
      `[forge] Transitioning ${allIssueIds.length} issue(s) across all milestones to "Done"`,
    );
    const batchResult = await client.updateIssueBatch(allIssueIds, { stateId: doneStateId });
    if (batchResult.success) {
      result.issuesTransitioned = batchResult.data.updated;
      result.issuesFailed = batchResult.data.failed;
    } else {
      console.warn(`[forge] Batch update failed: ${batchResult.error}`);
      result.issuesFailed = allIssueIds;
    }
  } else {
    console.log(
      `[forge] Transitioned 0 issue(s) across all milestones to "Done"`,
    );
  }

  // Transition project to completed
  const projectId = status.linearProjectId;
  if (projectId) {
    const projectStatusId = await client.resolveProjectStatusByCategory("completed");
    console.log(
      `[forge] Updating project ${projectId} to "Done"`,
    );
    const projectResult = await client.updateProjectState(projectId, projectStatusId);
    if (projectResult.success) {
      result.projectUpdated = true;
    } else {
      console.warn(`[forge] Failed to update project ${projectId}: ${projectResult.error}`);
      result.projectError = projectResult.error;
    }
  }

  return result;
}

/**
 * Promote project from Backlog to Planned.
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

  // Only promote from backlog — no-op if already planned or beyond
  const currentCategory = await client.getProjectStatusCategory(projectId);
  if (currentCategory && currentCategory !== "backlog") {
    console.log(`[forge] Project already at "${currentCategory}" — skipping planned transition`);
    return result;
  }

  const plannedStatusId = await client.resolveProjectStatusByCategory("planned");
  console.log(
    `[forge] Updating project ${projectId} to "Planned"`,
  );
  const projectResult = await client.updateProjectState(projectId, plannedStatusId);
  if (projectResult.success) {
    result.projectUpdated = true;
  } else {
    console.warn(`[forge] Failed to update project ${projectId}: ${projectResult.error}`);
    result.projectError = projectResult.error;
  }

  return result;
}
