import type { ForgeConfig, PRDStatus } from "../types.js";
import type { ForgeLinearClient } from "./client.js";

/**
 * Transition milestone issues to inProgress and project to inProgress.
 */
export async function syncMilestoneStart(
  client: ForgeLinearClient,
  config: ForgeConfig,
  status: PRDStatus,
  milestone: string,
): Promise<void> {
  const ms = status.milestones[milestone];
  if (!ms) {
    console.warn(`[forge] Milestone "${milestone}" not found in status file`);
    return;
  }

  const teamId = status.linearTeamId;
  if (!teamId) {
    console.warn("[forge] No linearTeamId in status file, skipping sync");
    return;
  }

  const stateId = await client.resolveStateId(
    teamId,
    config.linearStates.inProgress,
  );

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
    for (const issueId of issueIds) {
      await client.updateIssueState(issueId, stateId);
    }
  }

  // Transition project to inProgress
  const projectId = status.linearProjectId;
  if (projectId) {
    console.log(
      `[forge] Updating project ${projectId} to "${config.linearStates.inProgress}"`,
    );
    await client.updateProjectState(projectId, stateId);
  }
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
): Promise<void> {
  const ms = status.milestones[milestone];
  if (!ms) {
    console.warn(`[forge] Milestone "${milestone}" not found in status file`);
    return;
  }

  const teamId = status.linearTeamId;
  if (!teamId) {
    console.warn("[forge] No linearTeamId in status file, skipping sync");
    return;
  }

  const doneStateId = await client.resolveStateId(
    teamId,
    config.linearStates.done,
  );

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
    for (const issueId of issueIds) {
      await client.updateIssueState(issueId, doneStateId);
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
      await client.updateProjectState(projectId, reviewStateId);
    }
  }
}

/**
 * Transition all issues across all milestones to done and project to done.
 */
export async function syncProjectDone(
  client: ForgeLinearClient,
  config: ForgeConfig,
  status: PRDStatus,
): Promise<void> {
  const teamId = status.linearTeamId;
  if (!teamId) {
    console.warn("[forge] No linearTeamId in status file, skipping sync");
    return;
  }

  const doneStateId = await client.resolveStateId(
    teamId,
    config.linearStates.done,
  );

  // Transition all issues across all milestones to done
  let totalIssues = 0;
  for (const [name, ms] of Object.entries(status.milestones)) {
    const issueIds = ms.linearIssueIds ?? [];
    if (issueIds.length === 0) {
      console.warn(
        `[forge] No linearIssueIds for milestone "${name}" — skipping issue transitions`,
      );
      continue;
    }
    totalIssues += issueIds.length;
    for (const issueId of issueIds) {
      await client.updateIssueState(issueId, doneStateId);
    }
  }
  console.log(
    `[forge] Transitioned ${totalIssues} issue(s) across all milestones to "${config.linearStates.done}"`,
  );

  // Transition project to done
  const projectId = status.linearProjectId;
  if (projectId) {
    console.log(
      `[forge] Updating project ${projectId} to "${config.linearStates.done}"`,
    );
    await client.updateProjectState(projectId, doneStateId);
  }
}
