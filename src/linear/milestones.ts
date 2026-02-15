import { LinearClient, type LinearMilestone } from "./client.js";

/** Create a milestone under a project */
export async function createProjectMilestone(
  client: LinearClient,
  projectId: string,
  name: string,
  description?: string,
  targetDate?: string,
): Promise<LinearMilestone> {
  return client.createMilestone({
    projectId,
    name,
    description,
    targetDate,
  });
}

/** Get milestone progress: total and completed issue counts */
export async function getMilestoneProgress(
  client: LinearClient,
  projectId: string,
  milestoneName: string,
): Promise<{
  milestone: LinearMilestone;
  totalIssues: number;
  completedIssues: number;
}> {
  const milestone = await findMilestoneByName(client, projectId, milestoneName);
  if (!milestone) {
    throw new Error(
      `Milestone not found: "${milestoneName}" in project ${projectId}`,
    );
  }

  const issues = await client.listIssues({
    projectId,
    milestoneId: milestone.id,
  });
  const completedIssues = issues.filter(
    (i) => i.state === "Done" || i.state === "Canceled",
  ).length;

  return {
    milestone,
    totalIssues: issues.length,
    completedIssues,
  };
}

/** Find a milestone by name within a project */
export async function findMilestoneByName(
  client: LinearClient,
  projectId: string,
  name: string,
): Promise<LinearMilestone | null> {
  const milestones = await client.listMilestones(projectId);
  return milestones.find((m) => m.name === name) ?? null;
}
