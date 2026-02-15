/**
 * Syncs a PRD to Linear: creates milestones, issues (one per user story),
 * and transitions the project to "Planned".
 */

import { LinearClient } from "../linear/client.js";
import type { LinearMilestone, LinearIssue } from "../linear/client.js";
import { createProjectMilestone } from "../linear/milestones.js";
import { createMilestoneIssue } from "../linear/issues.js";
import { transitionProject } from "../linear/projects.js";
import type { PRDData, Milestone, UserStory } from "./templates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncedMilestone {
  prdNumber: number;
  name: string;
  linearMilestone: LinearMilestone;
  issues: SyncedIssue[];
}

export interface SyncedIssue {
  userStoryId: string;
  title: string;
  linearIssue: LinearIssue;
}

export interface IssueError {
  userStoryId: string;
  title: string;
  error: string;
}

export interface MilestoneError {
  prdNumber: number;
  name: string;
  error: string;
}

export interface SyncResult {
  projectId: string;
  milestonesCreated: number;
  issuesCreated: number;
  milestones: SyncedMilestone[];
  errors: {
    milestones: MilestoneError[];
    issues: IssueError[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build issue descriptions from user stories, including acceptance criteria.
 */
function buildIssueDescription(story: UserStory): string {
  const lines: string[] = [story.description];
  if (story.acceptanceCriteria.length > 0) {
    lines.push("", "## Acceptance Criteria");
    for (const criterion of story.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  }
  return lines.join("\n");
}

/**
 * Resolve which user stories belong to a milestone.
 * Each milestone's `waves` contain agents with tasks — we map all
 * user stories to the milestone based on the PRD structure.
 * Since milestones don't have explicit userStory references in the schema,
 * we distribute stories evenly across milestones, or assign all to the
 * first milestone if there's only one.
 */
function assignStoriesToMilestones(
  milestones: Milestone[],
  stories: UserStory[],
): Map<number, UserStory[]> {
  const map = new Map<number, UserStory[]>();

  if (milestones.length === 0) return map;

  // Initialize all milestones with empty arrays
  for (const m of milestones) {
    map.set(m.number, []);
  }

  // Distribute stories across milestones round-robin
  for (let i = 0; i < stories.length; i++) {
    const milestoneIdx = i % milestones.length;
    const milestoneNumber = milestones[milestoneIdx].number;
    map.get(milestoneNumber)!.push(stories[i]);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Sync a PRD to Linear:
 * 1. Create milestones (one per PRD milestone)
 * 2. Create issues under each milestone (one per user story)
 * 3. Transition project to "Planned"
 *
 * Handles partial failures — if a milestone or issue fails to create,
 * the error is captured and the sync continues with the rest.
 */
export async function syncPRDToLinear(
  prdData: PRDData,
  projectId: string,
  teamId: string,
  client: LinearClient,
): Promise<SyncResult> {
  const result: SyncResult = {
    projectId,
    milestonesCreated: 0,
    issuesCreated: 0,
    milestones: [],
    errors: {
      milestones: [],
      issues: [],
    },
  };

  const storyMap = assignStoriesToMilestones(
    prdData.milestones,
    prdData.userStories,
  );

  // 1. Create milestones and their issues
  for (const milestone of prdData.milestones) {
    let linearMilestone: LinearMilestone;

    try {
      linearMilestone = await createProjectMilestone(
        client,
        projectId,
        `M${milestone.number}: ${milestone.name}`,
        milestone.goal,
      );
    } catch (err) {
      result.errors.milestones.push({
        prdNumber: milestone.number,
        name: milestone.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue; // Skip issues for this milestone
    }

    result.milestonesCreated++;

    const syncedMilestone: SyncedMilestone = {
      prdNumber: milestone.number,
      name: milestone.name,
      linearMilestone,
      issues: [],
    };

    // Create issues for user stories assigned to this milestone
    const stories = storyMap.get(milestone.number) ?? [];
    for (const story of stories) {
      try {
        const linearIssue = await createMilestoneIssue(client, {
          title: `${story.id}: ${story.title}`,
          description: buildIssueDescription(story),
          teamId,
          projectId,
          milestoneId: linearMilestone.id,
        });

        syncedMilestone.issues.push({
          userStoryId: story.id,
          title: story.title,
          linearIssue,
        });
        result.issuesCreated++;
      } catch (err) {
        result.errors.issues.push({
          userStoryId: story.id,
          title: story.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    result.milestones.push(syncedMilestone);
  }

  // 2. Transition project to "Planned"
  await transitionProject(client, projectId, "Planned");

  return result;
}
