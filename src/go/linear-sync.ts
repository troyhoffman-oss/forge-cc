/**
 * Linear Status Sync for Execution Engine
 *
 * Bridges the milestone executor with the Linear project management client.
 * Manages issue and project state transitions during the go execution flow:
 *
 * - Milestone start: issues -> In Progress, project -> In Progress
 * - Mid-execution: progress comments on milestone issues
 * - Milestone complete: issues -> In Review (last milestone) or progress comment
 * - Project done: issues -> Done, project -> Done (post-merge)
 *
 * All operations degrade gracefully — the execution engine must never fail
 * because Linear is unavailable or misconfigured.
 */

import { LinearClient, LinearClientError } from "../linear/client.js";
import type { LinearIssue } from "../linear/client.js";
import { transitionProject } from "../linear/projects.js";
import { transitionMilestoneIssues, resolveStateId } from "../linear/issues.js";
import { findMilestoneByName } from "../linear/milestones.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinearSyncOptions {
  projectId: string;
  milestoneNumber: number;
  milestoneName: string; // e.g., "M4: Execution Engine (go)"
  teamId?: string; // for resolving state UUIDs
  apiKey?: string; // optional, falls back to LINEAR_API_KEY env
}

export interface MilestoneStartSync {
  linearMilestoneId: string | null;
  issuesUpdated: number;
  projectUpdated: boolean;
}

export interface MilestoneCompleteOptions extends LinearSyncOptions {
  isLastMilestone: boolean;
  prUrl?: string; // if PR was created
}

export interface MilestoneCompleteSync {
  issuesUpdated: number;
  projectUpdated: boolean;
  finalState: string;
}

export interface ProgressCommentOptions {
  projectId: string;
  milestoneNumber: number;
  milestoneName: string;
  message: string; // e.g., "Wave 2/3 complete. Verification passed."
  apiKey?: string;
}

export interface ProjectIssueIdentifiers {
  identifiers: string[]; // e.g., ["MSIG-123", "MSIG-124"]
  issues: Array<{ id: string; identifier: string; title: string }>;
}

export interface ProjectDoneSync {
  issuesUpdated: number;
  projectUpdated: boolean;
}

// ---------------------------------------------------------------------------
// Safe Wrapper
// ---------------------------------------------------------------------------

/**
 * Execute a Linear operation safely — catches LinearClientError and logs
 * a warning instead of crashing. The execution engine should never fail
 * because Linear is unavailable.
 *
 * Returns the function's result on success, or null on failure.
 */
export async function syncLinearSafe<T>(
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof LinearClientError) {
      console.warn(`[linear-sync] Linear operation failed: ${error.message}`);
      return null;
    }
    // Re-throw unexpected errors — they indicate bugs, not Linear issues
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Client Creation
// ---------------------------------------------------------------------------

/**
 * Attempt to create a LinearClient. Returns null and logs a warning
 * if no API key is available (graceful degradation).
 */
function createClientSafe(apiKey?: string): LinearClient | null {
  try {
    return new LinearClient(apiKey);
  } catch (error) {
    if (error instanceof LinearClientError) {
      console.warn(
        `[linear-sync] Linear client unavailable: ${error.message}`,
      );
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Milestone Start
// ---------------------------------------------------------------------------

/**
 * Sync Linear state when a milestone starts execution.
 *
 * - Finds the Linear milestone by name
 * - Transitions all milestone issues to "In Progress"
 * - Transitions the project to "In Progress" (if not already)
 *
 * Degrades gracefully if Linear is unavailable or the milestone is not found.
 */
export async function syncMilestoneStart(
  options: LinearSyncOptions,
): Promise<MilestoneStartSync> {
  const noopResult: MilestoneStartSync = {
    linearMilestoneId: null,
    issuesUpdated: 0,
    projectUpdated: false,
  };

  const client = createClientSafe(options.apiKey);
  if (!client) return noopResult;

  const result = await syncLinearSafe(async () => {
    // Find the milestone in Linear
    const milestone = await findMilestoneByName(
      client,
      options.projectId,
      options.milestoneName,
    );

    if (!milestone) {
      console.warn(
        `[linear-sync] Milestone "${options.milestoneName}" not found in project ${options.projectId}. Skipping issue transitions.`,
      );
      // Still try to transition the project
      let projectUpdated = false;
      try {
        await transitionProject(client, options.projectId, "In Progress");
        projectUpdated = true;
      } catch {
        // Project may already be In Progress or beyond — that's fine
      }

      return {
        linearMilestoneId: null,
        issuesUpdated: 0,
        projectUpdated,
      };
    }

    // Derive teamId from options or from milestone issues
    let teamId = options.teamId;
    if (!teamId) {
      const milestoneIssues = await client.listIssues({
        projectId: options.projectId,
        milestoneId: milestone.id,
      });
      teamId = milestoneIssues[0]?.teamId;
    }
    if (!teamId) {
      console.warn(
        `[linear-sync] No teamId available — cannot resolve state UUIDs. Skipping issue transitions.`,
      );
      // Still try to transition the project
      let projectUpdated = false;
      try {
        await transitionProject(client, options.projectId, "In Progress");
        projectUpdated = true;
      } catch {
        // Project may already be In Progress or beyond — that's fine
      }

      return {
        linearMilestoneId: milestone.id,
        issuesUpdated: 0,
        projectUpdated,
      };
    }

    // Transition milestone issues to In Progress
    const { updated } = await transitionMilestoneIssues(
      client,
      options.projectId,
      milestone.id,
      "In Progress",
      teamId,
    );

    // Transition project to In Progress
    let projectUpdated = false;
    try {
      await transitionProject(client, options.projectId, "In Progress");
      projectUpdated = true;
    } catch {
      // Project may already be In Progress or beyond — that's fine
    }

    return {
      linearMilestoneId: milestone.id,
      issuesUpdated: updated,
      projectUpdated,
    } satisfies MilestoneStartSync;
  });

  return result ?? noopResult;
}

// ---------------------------------------------------------------------------
// Milestone Complete
// ---------------------------------------------------------------------------

/**
 * Sync Linear state when a milestone completes.
 *
 * - If NOT the last milestone: adds a progress comment to each issue
 * - If IS the last milestone: transitions all project issues to "In Review",
 *   transitions the project to "In Review"
 *
 * Degrades gracefully if Linear is unavailable.
 */
export async function syncMilestoneComplete(
  options: MilestoneCompleteOptions,
): Promise<MilestoneCompleteSync> {
  const noopResult: MilestoneCompleteSync = {
    issuesUpdated: 0,
    projectUpdated: false,
    finalState: "unknown",
  };

  const client = createClientSafe(options.apiKey);
  if (!client) return noopResult;

  const result = await syncLinearSafe(async () => {
    if (!options.isLastMilestone) {
      // Mid-project milestone — add progress comments
      const milestone = await findMilestoneByName(
        client,
        options.projectId,
        options.milestoneName,
      );

      if (milestone) {
        const issues = await client.listIssues({
          projectId: options.projectId,
          milestoneId: milestone.id,
        });

        const commentBody = `Milestone ${options.milestoneNumber} complete. Moving to next milestone.`;
        for (const issue of issues) {
          await client.createComment(issue.id, commentBody);
        }

        return {
          issuesUpdated: issues.length,
          projectUpdated: false,
          finalState: "In Progress",
        } satisfies MilestoneCompleteSync;
      }

      return {
        issuesUpdated: 0,
        projectUpdated: false,
        finalState: "In Progress",
      } satisfies MilestoneCompleteSync;
    }

    // Last milestone — move everything to In Review
    // Get ALL project issues (not just this milestone's)
    const allIssues = await client.listIssues({
      projectId: options.projectId,
    });

    // Resolve state UUID for "In Review"
    const teamId = options.teamId ?? allIssues[0]?.teamId;
    let stateId: string | undefined;
    if (teamId) {
      try {
        stateId = await resolveStateId(client, teamId, "In Review");
      } catch {
        // State resolution failed — skip issue transitions
      }
    }

    let updatedCount = 0;
    for (const issue of allIssues) {
      if (issue.state !== "In Review" && issue.state !== "Done") {
        try {
          await client.updateIssue(issue.id, stateId ? { stateId } : { state: "In Review" });
          updatedCount++;
        } catch {
          // Some issues may not support this transition — skip them
        }
      }
    }

    // Add PR link comment if available
    if (options.prUrl) {
      for (const issue of allIssues) {
        try {
          await client.createComment(
            issue.id,
            `PR created: ${options.prUrl}`,
          );
        } catch {
          // Comment failures are non-critical
        }
      }
    }

    // Transition project to In Review
    let projectUpdated = false;
    try {
      await transitionProject(client, options.projectId, "In Review");
      projectUpdated = true;
    } catch {
      // Project may already be In Review or beyond — that's fine
    }

    return {
      issuesUpdated: updatedCount,
      projectUpdated,
      finalState: "In Review",
    } satisfies MilestoneCompleteSync;
  });

  return result ?? noopResult;
}

// ---------------------------------------------------------------------------
// Progress Comments
// ---------------------------------------------------------------------------

/**
 * Add a progress comment to all issues in a milestone.
 * Used during execution to keep Linear updated with wave progress.
 *
 * Degrades gracefully if Linear is unavailable or the milestone is not found.
 */
export async function addMilestoneProgressComment(
  options: ProgressCommentOptions,
): Promise<void> {
  const client = createClientSafe(options.apiKey);
  if (!client) return;

  await syncLinearSafe(async () => {
    const milestone = await findMilestoneByName(
      client,
      options.projectId,
      options.milestoneName,
    );

    if (!milestone) {
      console.warn(
        `[linear-sync] Milestone "${options.milestoneName}" not found. Skipping progress comment.`,
      );
      return;
    }

    const issues = await client.listIssues({
      projectId: options.projectId,
      milestoneId: milestone.id,
    });

    for (const issue of issues) {
      await client.createComment(issue.id, options.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Fetch Project Issue Identifiers
// ---------------------------------------------------------------------------

/**
 * Fetch all issue identifiers for a project (e.g., ["MSIG-123", "MSIG-124"]).
 * Used to inject `Closes TEAM-XXX` into PR descriptions so Linear's GitHub
 * integration auto-closes issues on merge.
 *
 * Degrades gracefully if Linear is unavailable.
 */
export async function fetchProjectIssueIdentifiers(
  options: { projectId: string; apiKey?: string },
): Promise<ProjectIssueIdentifiers | null> {
  const client = createClientSafe(options.apiKey);
  if (!client) return null;

  return syncLinearSafe(async () => {
    const allIssues = await client.listIssues({
      projectId: options.projectId,
    });

    return {
      identifiers: allIssues.map((issue) => issue.identifier),
      issues: allIssues.map((issue) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Project Done
// ---------------------------------------------------------------------------

/**
 * Transition all project issues and the project itself to "Done".
 * Intended for post-merge cleanup — run after a PR is merged to complete
 * the Linear lifecycle.
 *
 * Skips issues already in Done or Canceled state.
 * Degrades gracefully if Linear is unavailable.
 */
export async function syncProjectDone(
  options: { projectId: string; apiKey?: string },
): Promise<ProjectDoneSync> {
  const noopResult: ProjectDoneSync = { issuesUpdated: 0, projectUpdated: false };

  const client = createClientSafe(options.apiKey);
  if (!client) return noopResult;

  const result = await syncLinearSafe(async () => {
    const allIssues = await client.listIssues({
      projectId: options.projectId,
    });

    // Resolve state UUID for "Done"
    const teamId = allIssues[0]?.teamId;
    let stateId: string | undefined;
    if (teamId) {
      try {
        stateId = await resolveStateId(client, teamId, "Done");
      } catch {
        // State resolution failed — fall back to name
      }
    }

    let updatedCount = 0;
    for (const issue of allIssues) {
      if (issue.state !== "Done" && issue.state !== "Canceled") {
        try {
          await client.updateIssue(issue.id, stateId ? { stateId } : { state: "Done" });
          updatedCount++;
        } catch {
          // Some issues may not support this transition — skip them
        }
      }
    }

    let projectUpdated = false;
    try {
      await transitionProject(client, options.projectId, "Done");
      projectUpdated = true;
    } catch {
      // Project may already be Done or the transition may be invalid
    }

    return { issuesUpdated: updatedCount, projectUpdated };
  });

  return result ?? noopResult;
}
