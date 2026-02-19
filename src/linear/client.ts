import { LinearClient } from "@linear/sdk";

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
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    try {
      await this.client.updateIssue(issueId, { stateId });
    } catch (err) {
      console.warn(`[forge] Failed to update issue ${issueId}:`, err);
    }
  }

  /** Update a project's status (state name in Linear projects). */
  async updateProjectState(
    projectId: string,
    stateId: string,
  ): Promise<void> {
    try {
      await this.client.updateProject(projectId, { statusId: stateId });
    } catch (err) {
      console.warn(`[forge] Failed to update project ${projectId}:`, err);
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
}
