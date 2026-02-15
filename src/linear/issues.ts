import { LinearClient, type LinearIssue } from "./client.js";

/** Valid issue states */
export const ISSUE_STATES = [
  "Backlog",
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Canceled",
] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

/** Create an issue under a project milestone */
export async function createMilestoneIssue(
  client: LinearClient,
  input: {
    title: string;
    description?: string;
    teamId: string;
    projectId: string;
    milestoneId: string;
    priority?: number;
  },
): Promise<LinearIssue> {
  return client.createIssue({
    title: input.title,
    description: input.description,
    teamId: input.teamId,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    priority: input.priority,
  });
}

/** Transition all issues in a milestone to a target state */
export async function transitionMilestoneIssues(
  client: LinearClient,
  projectId: string,
  milestoneId: string,
  targetState: string,
): Promise<{ updated: number; issues: LinearIssue[] }> {
  const issues = await client.listIssues({ projectId, milestoneId });

  const updatedIssues: LinearIssue[] = [];
  for (const issue of issues) {
    if (issue.state !== targetState) {
      const updated = await client.updateIssue(issue.id, {
        state: targetState,
      });
      updatedIssues.push(updated);
    }
  }

  return { updated: updatedIssues.length, issues: updatedIssues };
}

/** Add a progress comment to an issue */
export async function addProgressComment(
  client: LinearClient,
  issueId: string,
  message: string,
): Promise<void> {
  await client.createComment(issueId, message);
}
