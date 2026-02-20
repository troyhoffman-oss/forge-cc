import { LinearClient, IssueRelationType } from "@linear/sdk";
export { IssueRelationType } from "@linear/sdk";

export type LinearResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface ForgeLinearClientOptions {
  apiKey: string;
  teamId?: string;
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

  /** Resolve a workflow state UUID by its display name for a given team. */
  async resolveStateId(teamId: string, stateName: string): Promise<string> {
    try {
      const states = await this.client.workflowStates({
        filter: {
          team: { id: { eq: teamId } },
          name: { eq: stateName },
        },
      });
      const node = states.nodes[0];
      if (!node) {
        throw new Error(
          `Workflow state "${stateName}" not found for team ${teamId}`,
        );
      }
      return node.id;
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        throw err;
      }
      console.warn(`[forge] Failed to resolve state "${stateName}":`, err);
      throw err;
    }
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
      const message =
        err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message =
        err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
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
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}
