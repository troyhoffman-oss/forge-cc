import { LinearClient, type LinearProject } from "./client.js";

/** Valid project states in forward-only order */
export const PROJECT_STATES = [
  "Backlog",
  "Planned",
  "In Progress",
  "In Review",
  "Done",
] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

/** State index map for transition validation */
const stateIndex = new Map<string, number>(
  PROJECT_STATES.map((s, i) => [s, i]),
);

/**
 * Validate that a project state transition is forward-only.
 * Backlog -> Planned -> In Progress -> In Review -> Done.
 * Same-state transitions are not valid (no-op).
 */
export function isValidTransition(from: string, to: string): boolean {
  const fromIdx = stateIndex.get(from);
  const toIdx = stateIndex.get(to);
  if (fromIdx === undefined || toIdx === undefined) return false;
  return toIdx > fromIdx;
}

/** Create a new project in Backlog state (used during triage) */
export async function createTriageProject(
  client: LinearClient,
  name: string,
  description: string,
  teamIds: string[],
): Promise<LinearProject> {
  return client.createProject({
    name,
    description,
    teamIds,
    state: "Backlog",
  });
}

/** Transition a project to a target state with forward-only validation */
export async function transitionProject(
  client: LinearClient,
  projectId: string,
  targetState: string,
): Promise<LinearProject> {
  // Fetch current project to validate transition
  const projects = await client.listProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  if (!isValidTransition(project.state, targetState)) {
    throw new Error(
      `Invalid project transition: ${project.state} -> ${targetState}`,
    );
  }
  return client.updateProject(projectId, { state: targetState });
}

/** Find an existing project by exact name (for dedup during triage) */
export async function findProjectByName(
  client: LinearClient,
  name: string,
): Promise<LinearProject | null> {
  const projects = await client.listProjects({ query: name });
  return projects.find((p) => p.name === name) ?? null;
}
