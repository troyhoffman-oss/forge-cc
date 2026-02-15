/**
 * Typed wrapper around the Linear GraphQL API.
 * Used by lifecycle modules (projects.ts, milestones.ts, issues.ts)
 * and the execution engine for programmatic Linear management.
 */

const LINEAR_API_URL = "https://api.linear.app/graphql";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  url: string;
}

export interface LinearMilestone {
  id: string;
  name: string;
  description?: string;
  progress: number;
  sortOrder: number;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: string;
  projectId?: string;
  milestoneId?: string;
  url: string;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  teamIds: string[];
  state?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  state?: string;
}

export interface CreateMilestoneInput {
  projectId: string;
  name: string;
  description?: string;
  targetDate?: string;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  teamId: string;
  projectId?: string;
  milestoneId?: string;
  priority?: number;
  state?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  state?: string;
  milestoneId?: string;
  priority?: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class LinearClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly errors?: Array<{ message: string }>,
  ) {
    super(message);
    this.name = "LinearClientError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LinearClient {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.LINEAR_API_KEY;
    if (!key) {
      throw new LinearClientError(
        "Linear API key not found. Set the LINEAR_API_KEY environment variable or pass it to the constructor.",
      );
    }
    this.apiKey = key;
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  async listProjects(opts?: {
    query?: string;
    state?: string;
  }): Promise<LinearProject[]> {
    const filter: Record<string, unknown> = {};
    if (opts?.query) {
      filter.name = { containsIgnoreCase: opts.query };
    }
    if (opts?.state) {
      filter.state = { eq: opts.state };
    }

    const hasFilter = Object.keys(filter).length > 0;
    const filterVar = hasFilter ? ", $filter: ProjectFilter" : "";
    const filterArg = hasFilter ? ", filter: $filter" : "";

    const query = `
      query ListProjects($after: String${filterVar}) {
        projects(first: 50, after: $after${filterArg}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id name description state url
          }
        }
      }
    `;

    return this.paginate<LinearProject>(query, "projects", {
      ...(hasFilter ? { filter } : {}),
    });
  }

  async createProject(input: CreateProjectInput): Promise<LinearProject> {
    const mutation = `
      mutation CreateProject($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          success
          project { id name description state url }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      input: {
        name: input.name,
        ...(input.description != null && { description: input.description }),
        teamIds: input.teamIds,
        ...(input.state != null && { state: input.state }),
      },
    };

    const data = await this.request(mutation, variables);
    const result = data.projectCreate;
    if (!result?.success) {
      throw new LinearClientError("Failed to create project");
    }
    return result.project as LinearProject;
  }

  async updateProject(
    id: string,
    input: UpdateProjectInput,
  ): Promise<LinearProject> {
    const mutation = `
      mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) {
          success
          project { id name description state url }
        }
      }
    `;

    const data = await this.request(mutation, { id, input });
    const result = data.projectUpdate;
    if (!result?.success) {
      throw new LinearClientError(`Failed to update project ${id}`);
    }
    return result.project as LinearProject;
  }

  // -------------------------------------------------------------------------
  // Milestones (Project Milestones)
  // -------------------------------------------------------------------------

  async listMilestones(projectId: string): Promise<LinearMilestone[]> {
    const query = `
      query ListMilestones($projectId: String!, $after: String) {
        project(id: $projectId) {
          projectMilestones(first: 50, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id name description progress sortOrder
            }
          }
        }
      }
    `;

    // Custom pagination because the nodes are nested under project
    const all: LinearMilestone[] = [];
    let after: string | null = null;

    for (;;) {
      const data = await this.request(query, { projectId, after });
      const connection = data.project?.projectMilestones;
      if (!connection) break;

      all.push(...(connection.nodes as LinearMilestone[]));

      if (connection.pageInfo.hasNextPage) {
        after = connection.pageInfo.endCursor;
      } else {
        break;
      }
    }

    return all;
  }

  async createMilestone(
    input: CreateMilestoneInput,
  ): Promise<LinearMilestone> {
    const mutation = `
      mutation CreateMilestone($input: ProjectMilestoneCreateInput!) {
        projectMilestoneCreate(input: $input) {
          success
          projectMilestone { id name description progress sortOrder }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      input: {
        projectId: input.projectId,
        name: input.name,
        ...(input.description != null && { description: input.description }),
        ...(input.targetDate != null && { targetDate: input.targetDate }),
      },
    };

    const data = await this.request(mutation, variables);
    const result = data.projectMilestoneCreate;
    if (!result?.success) {
      throw new LinearClientError("Failed to create milestone");
    }
    return result.projectMilestone as LinearMilestone;
  }

  // -------------------------------------------------------------------------
  // Issues
  // -------------------------------------------------------------------------

  async listIssues(opts?: {
    projectId?: string;
    milestoneId?: string;
    state?: string;
  }): Promise<LinearIssue[]> {
    const filter: Record<string, unknown> = {};
    if (opts?.projectId) {
      filter.project = { id: { eq: opts.projectId } };
    }
    if (opts?.milestoneId) {
      filter.projectMilestone = { id: { eq: opts.milestoneId } };
    }
    if (opts?.state) {
      filter.state = { name: { eqIgnoreCase: opts.state } };
    }

    const hasFilter = Object.keys(filter).length > 0;
    const filterVar = hasFilter ? ", $filter: IssueFilter" : "";
    const filterArg = hasFilter ? ", filter: $filter" : "";

    const query = `
      query ListIssues($after: String${filterVar}) {
        issues(first: 50, after: $after${filterArg}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id identifier title description url
            state { name }
            project { id }
            projectMilestone { id }
          }
        }
      }
    `;

    const raw = await this.paginate<Record<string, unknown>>(
      query,
      "issues",
      hasFilter ? { filter } : {},
    );

    return raw.map((node) => this.mapIssue(node));
  }

  async createIssue(input: CreateIssueInput): Promise<LinearIssue> {
    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id identifier title description url
            state { name }
            project { id }
            projectMilestone { id }
          }
        }
      }
    `;

    const issueInput: Record<string, unknown> = {
      title: input.title,
      teamId: input.teamId,
      ...(input.description != null && { description: input.description }),
      ...(input.projectId != null && { projectId: input.projectId }),
      ...(input.milestoneId != null && {
        projectMilestoneId: input.milestoneId,
      }),
      ...(input.priority != null && { priority: input.priority }),
    };

    // state is a name string; Linear expects stateId. The caller should resolve
    // this upstream, but if provided we pass it as-is and let Linear resolve.
    if (input.state != null) {
      issueInput.stateId = input.state;
    }

    const data = await this.request(mutation, { input: issueInput });
    const result = data.issueCreate;
    if (!result?.success) {
      throw new LinearClientError("Failed to create issue");
    }
    return this.mapIssue(result.issue);
  }

  async updateIssue(
    id: string,
    input: UpdateIssueInput,
  ): Promise<LinearIssue> {
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id identifier title description url
            state { name }
            project { id }
            projectMilestone { id }
          }
        }
      }
    `;

    const issueInput: Record<string, unknown> = {};
    if (input.title != null) issueInput.title = input.title;
    if (input.description != null) issueInput.description = input.description;
    if (input.state != null) issueInput.stateId = input.state;
    if (input.milestoneId != null)
      issueInput.projectMilestoneId = input.milestoneId;
    if (input.priority != null) issueInput.priority = input.priority;

    const data = await this.request(mutation, { id, input: issueInput });
    const result = data.issueUpdate;
    if (!result?.success) {
      throw new LinearClientError(`Failed to update issue ${id}`);
    }
    return this.mapIssue(result.issue);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const mutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `;

    const data = await this.request(mutation, {
      input: { issueId, body },
    });
    if (!data.commentCreate?.success) {
      throw new LinearClientError(
        `Failed to create comment on issue ${issueId}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Teams
  // -------------------------------------------------------------------------

  async listTeams(): Promise<LinearTeam[]> {
    const query = `
      query ListTeams($after: String) {
        teams(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id name key }
        }
      }
    `;

    return this.paginate<LinearTeam>(query, "teams", {});
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Execute a GraphQL request against the Linear API with retry + backoff.
   */
  private async request(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      let res: Response;
      try {
        res = await fetch(LINEAR_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: this.apiKey,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        lastError =
          err instanceof Error ? err : new Error(String(err));
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        lastError = new LinearClientError(
          `Linear API returned ${res.status}`,
          res.status,
        );
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new LinearClientError(
          `Linear API error ${res.status}: ${body}`,
          res.status,
        );
      }

      const json = (await res.json()) as {
        data?: Record<string, any>;
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        throw new LinearClientError(
          `GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`,
          undefined,
          json.errors,
        );
      }

      if (!json.data) {
        throw new LinearClientError("No data in Linear API response");
      }

      return json.data;
    }

    throw lastError ?? new LinearClientError("Request failed after retries");
  }

  /**
   * Auto-paginate a connection query. The query MUST accept `$after: String`
   * and the root field must return `{ pageInfo { hasNextPage endCursor } nodes { ... } }`.
   */
  private async paginate<T>(
    query: string,
    rootField: string,
    variables: Record<string, unknown>,
  ): Promise<T[]> {
    const all: T[] = [];
    let after: string | null = null;

    for (;;) {
      const data = await this.request(query, { ...variables, after });
      const connection = data[rootField];
      if (!connection) break;

      all.push(...(connection.nodes as T[]));

      if (connection.pageInfo.hasNextPage) {
        after = connection.pageInfo.endCursor;
      } else {
        break;
      }
    }

    return all;
  }

  /** Normalize a raw issue node from GraphQL into our flat LinearIssue shape. */
  private mapIssue(node: Record<string, any>): LinearIssue {
    return {
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      description: node.description ?? undefined,
      state: node.state?.name ?? "Unknown",
      projectId: node.project?.id ?? undefined,
      milestoneId: node.projectMilestone?.id ?? undefined,
      url: node.url,
    };
  }
}
