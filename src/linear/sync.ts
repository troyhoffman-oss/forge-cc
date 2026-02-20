import type { ForgeConfig, PRDStatus } from "../types.js";
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
 * Transition milestone issues to inProgress and project to inProgress.
 */
export async function syncMilestoneStart(
  client: ForgeLinearClient,
  config: ForgeConfig,
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

  const stateId = await client.resolveStateId(
    teamId,
    config.linearStates.inProgress,
  );

  const result = emptySyncResult();

  // Transition milestone issues to inProgress
  const issueIds = ms.linearIssueIds ?? [];
  if (issueIds.length === 0) {
    console.warn(
      `[forge] No linearIssueIds for milestone "${milestone}" — skipping issue transitions`,
    );
  } else {
    console.log(
      `[forge] Transitioning ${issueIds.length} issue(s) to "${config.linearStates.inProgress}"`,
    );
    const batchResult = await client.updateIssueBatch(issueIds, { stateId });
    if (batchResult.success) {
      result.issuesTransitioned = batchResult.data.updated;
      result.issuesFailed = batchResult.data.failed;
    } else {
      console.warn(`[forge] Batch update failed: ${batchResult.error}`);
      result.issuesFailed = issueIds;
    }
  }

  // Transition project to inProgress
  const projectId = status.linearProjectId;
  if (projectId) {
    console.log(
      `[forge] Updating project ${projectId} to "${config.linearStates.inProgress}"`,
    );
    const projectResult = await client.updateProjectState(projectId, stateId);
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
 * Transition milestone issues to done.
 * If isLast, transition project to inReview.
 */
export async function syncMilestoneComplete(
  client: ForgeLinearClient,
  config: ForgeConfig,
  status: PRDStatus,
  milestone: string,
  isLast: boolean,
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

  const doneStateId = await client.resolveStateId(
    teamId,
    config.linearStates.done,
  );

  const result = emptySyncResult();

  // Transition milestone issues to done
  const issueIds = ms.linearIssueIds ?? [];
  if (issueIds.length === 0) {
    console.warn(
      `[forge] No linearIssueIds for milestone "${milestone}" — skipping issue transitions`,
    );
  } else {
    console.log(
      `[forge] Transitioning ${issueIds.length} issue(s) to "${config.linearStates.done}"`,
    );
    const batchResult = await client.updateIssueBatch(issueIds, { stateId: doneStateId });
    if (batchResult.success) {
      result.issuesTransitioned = batchResult.data.updated;
      result.issuesFailed = batchResult.data.failed;
    } else {
      console.warn(`[forge] Batch update failed: ${batchResult.error}`);
      result.issuesFailed = issueIds;
    }
  }

  // If last milestone, transition project to inReview
  if (isLast) {
    const projectId = status.linearProjectId;
    if (projectId) {
      const reviewStateId = await client.resolveStateId(
        teamId,
        config.linearStates.inReview,
      );
      console.log(
        `[forge] Updating project ${projectId} to "${config.linearStates.inReview}" (last milestone)`,
      );
      const projectResult = await client.updateProjectState(projectId, reviewStateId);
      if (projectResult.success) {
        result.projectUpdated = true;
      } else {
        console.warn(`[forge] Failed to update project ${projectId}: ${projectResult.error}`);
        result.projectError = projectResult.error;
      }
    }
  }

  return result;
}

/**
 * Transition all issues across all milestones to done and project to done.
 */
export async function syncProjectDone(
  client: ForgeLinearClient,
  config: ForgeConfig,
  status: PRDStatus,
): Promise<SyncResult> {
  const teamId = status.linearTeamId;
  if (!teamId) {
    console.warn("[forge] No linearTeamId in status file, skipping sync");
    return emptySyncResult();
  }

  const doneStateId = await client.resolveStateId(
    teamId,
    config.linearStates.done,
  );

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
      `[forge] Transitioning ${allIssueIds.length} issue(s) across all milestones to "${config.linearStates.done}"`,
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
      `[forge] Transitioned 0 issue(s) across all milestones to "${config.linearStates.done}"`,
    );
  }

  // Transition project to done
  const projectId = status.linearProjectId;
  if (projectId) {
    console.log(
      `[forge] Updating project ${projectId} to "${config.linearStates.done}"`,
    );
    const projectResult = await client.updateProjectState(projectId, doneStateId);
    if (projectResult.success) {
      result.projectUpdated = true;
    } else {
      console.warn(`[forge] Failed to update project ${projectId}: ${projectResult.error}`);
      result.projectError = projectResult.error;
    }
  }

  return result;
}
