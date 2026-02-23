import { LinearClient, IssueRelationType } from "@linear/sdk";
export { IssueRelationType } from "@linear/sdk";

export type LinearResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function wrapError<T>(err: unknown): LinearResult<T> {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

export interface ForgeLinearClientOptions {
  apiKey: string;
  teamId?: string;
}

/**
 * Map Linear workflow state categories to their default display names.
 * Must stay in sync with the Linear workspace status names.
 * Used as a fallback when category-based lookup returns no results
 * (e.g. when a workspace has statuses with undefined categories).
 */
export function categoryToName(category: string): string {
  const map: Record<string, string> = {
    started: "In Progress",
    completed: "Done",
    planned: "Planned",
    backlog: "Backlog",
    cancelled: "Cancelled",
    triage: "Triage",
    // "In Review" shares the "started" category with "In Progress" in Linear's data model.
    // This entry is for documentation and name-based fallback lookups only.
    inReview: "In Review",
  };
  return map[category] ?? category;
}

/**
 * Thin wrapper around @linear/sdk's LinearClient, scoped to a team.
 * All public methods degrade gracefully on API errors (warn, don't crash).
 */
export class ForgeLinearClient {
  private readonly client: LinearClient;
  private readonly teamId: string | undefined;

  constructor(opts: ForgeLinearClientOptions) {
    if (!opts.apiKey) {
      throw new Error(
        "LINEAR_API_KEY is required. Set it as an environment variable or pass it to ForgeLinearClient.",
      );
    }
    this.client = new LinearClient({ apiKey: opts.apiKey });
    this.teamId = opts.teamId;
  }

  /** Resolve an issue workflow state UUID by category (e.g. "started", "completed"). */
  async resolveIssueStateByCategory(teamId: string, category: string, nameHint?: string): Promise<string> {
    // 1. Try category-based lookup (existing behavior)
    const states = await this.client.workflowStates({
      filter: { team: { id: { eq: teamId } }, type: { eq: category } },
    });
    if (states.nodes.length > 0) {
      if (nameHint) {
        const match = states.nodes.find((s) => s.name === nameHint);
        if (match) return match.id;
      }
      return states.nodes[0].id;
    }

    // 2. Fallback: search all states by name
    const nameToFind = nameHint ?? categoryToName(category);
    const allStates = await this.client.workflowStates({
      filter: { team: { id: { eq: teamId } } },
    });
    const nameMatch = allStates.nodes.find((s) => s.name === nameToFind);
    if (nameMatch) return nameMatch.id;

    throw new Error(`No workflow state matching category "${category}" or name "${nameToFind}" for team ${teamId}`);
  }

  /** Resolve a project status UUID by category (e.g. "planned", "started", "completed"). */
  async resolveProjectStatusByCategory(category: string, nameHint?: string): Promise<string> {
    // 1. Try category-based lookup
    const { nodes } = await this.client.projectStatuses();
    const categoryMatches = nodes.filter((s) => s.type === category);
    if (categoryMatches.length > 0) {
      if (nameHint) {
        const match = categoryMatches.find((s) => s.name === nameHint);
        if (match) return match.id;
      }
      return categoryMatches[0].id;
    }

    // 2. Fallback: search all statuses by name
    const nameToFind = nameHint ?? categoryToName(category);
    const nameMatch = nodes.find((s) => s.name === nameToFind);
    if (nameMatch) return nameMatch.id;

    throw new Error(`No project status matching category "${category}" or name "${nameToFind}" found`);
  }

  /** Update an issue's workflow state. */
  async updateIssueState(
    issueId: string,
    stateId: string,
  ): Promise<LinearResult<void>> {
    try {
      await this.client.updateIssue(issueId, { stateId });
      return { success: true, data: undefined };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Resolve a Linear issue UUID to its human-readable identifier (e.g. "FRG-42"). */
  async getIssueIdentifier(issueId: string): Promise<LinearResult<string>> {
    try {
      const issue = await this.client.issue(issueId);
      return { success: true, data: issue.identifier };
    } catch (err) {
      return wrapError(err);
    }
  }

  /**
   * Validate whether a git branch is already linked to a Linear issue.
   * Linear's current IssueUpdateInput does not support setting `branchName` via mutation.
   */
  async attachIssueBranch(
    issueId: string,
    branchName: string,
  ): Promise<LinearResult<void>> {
    try {
      const linkedIssue = await this.client.issueVcsBranchSearch(branchName);
      if (!linkedIssue) {
        return {
          success: false,
          error:
            `Branch "${branchName}" is not linked in Linear yet. ` +
            "Linear links branches from connected VCS activity (push/PR), not via issue update.",
        };
      }
      if (linkedIssue.id !== issueId) {
        return {
          success: false,
          error:
            `Branch "${branchName}" is linked to ${linkedIssue.identifier}, ` +
            `not issue id ${issueId}.`,
        };
      }
      return { success: true, data: undefined };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Attach a GitHub PR URL to an issue. Warn-only callers can use this to continue on failures. */
  async attachIssuePullRequest(
    issueId: string,
    prUrl: string,
  ): Promise<LinearResult<void>> {
    try {
      await this.client.attachmentLinkGitHubPR(issueId, prUrl);
      return { success: true, data: undefined };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Update a project's status (state name in Linear projects). */
  async updateProjectState(
    projectId: string,
    stateId: string,
  ): Promise<LinearResult<void>> {
    try {
      await this.client.updateProject(projectId, { statusId: stateId });
      return { success: true, data: undefined };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Get the current status category of a project (e.g. "backlog", "planned", "started", "completed"). */
  async getProjectStatusCategory(projectId: string): Promise<string | null> {
    try {
      const project = await this.client.project(projectId);
      const status = await project.status;
      return status?.type ?? null;
    } catch (err) {
      console.warn(`[forge] Failed to get project status category:`, err);
      return null;
    }
  }

  /** List all teams visible to the authenticated user. */
  async listTeams(): Promise<Array<{ id: string; name: string; key: string }>> {
    try {
      const result = await this.client.teams();
      return result.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key }));
    } catch (err) {
      console.warn("[forge] Failed to list teams:", err);
      return [];
    }
  }

  /** List issues belonging to a project. Returns identifier (e.g. "MSIG-123") and title. */
  async listIssuesByProject(
    projectId: string,
  ): Promise<Array<{ id: string; identifier: string; title: string }>> {
    try {
      const result = await this.client.issues({
        filter: {
          project: { id: { eq: projectId } },
        },
      });
      return result.nodes.map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
      }));
    } catch (err) {
      console.warn("[forge] Failed to list issues by project:", err);
      return [];
    }
  }

  /** List projects filtered by team. */
  async listProjects(
    teamId: string,
  ): Promise<Array<{ id: string; name: string; state: string }>> {
    try {
      const result = await this.client.projects({
        filter: {
          accessibleTeams: { some: { id: { eq: teamId } } },
        },
      });
      const projects: Array<{ id: string; name: string; state: string }> = [];
      for (const p of result.nodes) {
        const status = await p.status;
        projects.push({ id: p.id, name: p.name, state: status?.name ?? "Unknown" });
      }
      return projects;
    } catch (err) {
      console.warn("[forge] Failed to list projects:", err);
      return [];
    }
  }

  /** Create a new project. */
  async createProject(input: {
    name: string;
    description?: string;
    teamIds: string[];
    priority?: number;
  }): Promise<LinearResult<{ id: string; url: string }>> {
    try {
      const payload = await this.client.createProject(input);
      const project = payload.project;
      if (!project) {
        return { success: false, error: "Project creation returned no data" };
      }
      const resolved = await project;
      return {
        success: true,
        data: { id: resolved.id, url: resolved.url },
      };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Create a new milestone within a project. */
  async createMilestone(input: {
    name: string;
    description?: string;
    projectId: string;
    targetDate?: string;
  }): Promise<LinearResult<{ id: string }>> {
    try {
      const payload = await this.client.createProjectMilestone(input);
      const milestone = payload.projectMilestone;
      if (!milestone) {
        return {
          success: false,
          error: "Milestone creation returned no data",
        };
      }
      const resolved = await milestone;
      return { success: true, data: { id: resolved.id } };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Create a single issue. */
  async createIssue(input: {
    title: string;
    description?: string;
    teamId: string;
    projectId?: string;
    projectMilestoneId?: string;
    priority?: number;
    stateId?: string;
  }): Promise<LinearResult<{ id: string; identifier: string }>> {
    try {
      const payload = await this.client.createIssue(input);
      const issue = payload.issue;
      if (!issue) {
        return { success: false, error: "Issue creation returned no data" };
      }
      const resolved = await issue;
      return {
        success: true,
        data: { id: resolved.id, identifier: resolved.identifier },
      };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Create multiple issues in a single batch request. */
  async createIssueBatch(
    issues: Array<{
      title: string;
      description?: string;
      teamId: string;
      projectId?: string;
      projectMilestoneId?: string;
      priority?: number;
      stateId?: string;
    }>,
  ): Promise<LinearResult<{ ids: string[]; identifiers: string[] }>> {
    try {
      const payload = await this.client.createIssueBatch({ issues });
      const created = payload.issues ?? [];
      const ids: string[] = [];
      const identifiers: string[] = [];
      for (const issue of created) {
        ids.push(issue.id);
        identifiers.push(issue.identifier);
      }
      return { success: true, data: { ids, identifiers } };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Create a relation between two projects. */
  async createProjectRelation(input: {
    projectId: string;
    relatedProjectId: string;
    type: string;
    anchorType?: string;
    relatedAnchorType?: string;
  }): Promise<LinearResult<{ id: string }>> {
    try {
      const payload = await this.client.createProjectRelation({
        projectId: input.projectId,
        relatedProjectId: input.relatedProjectId,
        type: input.type,
        anchorType: input.anchorType ?? input.type,
        relatedAnchorType: input.relatedAnchorType ?? input.type,
      });
      const relation = payload.projectRelation;
      if (!relation) {
        return {
          success: false,
          error: "Project relation creation returned no data",
        };
      }
      const resolved = await relation;
      return { success: true, data: { id: resolved.id } };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Create a relation between two issues. */
  async createIssueRelation(input: {
    issueId: string;
    relatedIssueId: string;
    type: IssueRelationType;
  }): Promise<LinearResult<{ id: string }>> {
    try {
      const payload = await this.client.createIssueRelation(input);
      const relation = payload.issueRelation;
      if (!relation) {
        return {
          success: false,
          error: "Issue relation creation returned no data",
        };
      }
      const resolved = await relation;
      return { success: true, data: { id: resolved.id } };
    } catch (err) {
      return wrapError(err);
    }
  }

  /** Batch-update multiple issues (e.g. transition state). */
  async updateIssueBatch(
    ids: string[],
    input: { stateId: string },
  ): Promise<LinearResult<{ updated: number; failed: string[] }>> {
    try {
      const payload = await this.client.updateIssueBatch(ids, input);
      const issues = payload.issues;
      const updatedIds = issues ? issues.map((i) => i.id) : [];
      const updatedSet = new Set(updatedIds);
      const failed = ids.filter((id) => !updatedSet.has(id));
      return { success: true, data: { updated: updatedIds.length, failed } };
    } catch (err) {
      return wrapError(err);
    }
  }

}
