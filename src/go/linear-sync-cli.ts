/**
 * CLI adapter for Linear milestone sync.
 *
 * Bridges CLI arguments (slug + milestone number) to the LinearSyncOptions
 * that syncMilestoneStart() / syncMilestoneComplete() need. All functions
 * degrade gracefully — they return null when config or API key is missing.
 */

import { join } from "node:path";
import { LinearClient, LinearClientError } from "../linear/client.js";
import { findProjectByName } from "../linear/projects.js";
import { readPRDStatus } from "../state/prd-status.js";
import { readCurrentMilestone } from "../state/reader.js";
import { loadConfig } from "../config/loader.js";
import {
  syncMilestoneStart,
  syncMilestoneComplete,
  fetchProjectIssueIdentifiers,
  syncProjectDone,
} from "./linear-sync.js";
import type {
  MilestoneStartSync,
  MilestoneCompleteSync,
  ProjectIssueIdentifiers,
  ProjectDoneSync,
} from "./linear-sync.js";

// ---------------------------------------------------------------------------
// Resolve Linear Project ID
// ---------------------------------------------------------------------------

/**
 * Resolve the Linear project ID for a PRD slug.
 *
 * 1. Reads `linearProjectId` from `.planning/status/<slug>.json`
 * 2. Falls back to `linearProject` name from `.forge.json`, resolved via
 *    `findProjectByName()` against the Linear API
 *
 * Returns null if neither is configured or if the API key is missing.
 */
export async function resolveLinearProjectId(
  projectDir: string,
  slug: string,
): Promise<string | null> {
  // Try status file first
  const status = await readPRDStatus(projectDir, slug);
  if (status?.linearProjectId) {
    return status.linearProjectId;
  }

  // Fall back to .forge.json linearProject name
  const config = loadConfig(projectDir);
  if (!config.linearProject) {
    return null;
  }

  // Need a LinearClient to resolve by name
  let client: LinearClient;
  try {
    client = new LinearClient();
  } catch (error) {
    if (error instanceof LinearClientError) {
      console.warn("[linear-sync] WARN: LINEAR_API_KEY not set — skipping Linear sync");
      return null;
    }
    throw error;
  }

  const project = await findProjectByName(client, config.linearProject);
  return project?.id ?? null;
}

// ---------------------------------------------------------------------------
// Resolve Milestone Name
// ---------------------------------------------------------------------------

/**
 * Resolve the milestone display name from the PRD.
 *
 * Parses the `### Milestone N: Name` header and formats as `M{N}: {name}`
 * to match how `src/spec/linear-sync.ts` creates Linear milestones.
 *
 * Falls back to `M{N}` when the milestone is not found in the PRD.
 */
export async function resolveMilestoneName(
  projectDir: string,
  slug: string,
  milestoneNumber: number,
): Promise<string> {
  const prdPath = join(projectDir, ".planning", "prds", `${slug}.md`);
  const section = await readCurrentMilestone(prdPath, milestoneNumber);

  if (!section) {
    return `M${milestoneNumber}`;
  }

  // Extract name from "### Milestone N: Name" header
  const headerMatch = section.match(
    /^###\s*Milestone\s+\d+\s*[:\u2014\u2013-]\s*(.+)/m,
  );
  if (!headerMatch) {
    return `M${milestoneNumber}`;
  }

  const name = headerMatch[1].trim();
  return `M${milestoneNumber}: ${name}`;
}

// ---------------------------------------------------------------------------
// CLI Sync Start
// ---------------------------------------------------------------------------

/**
 * Sync Linear state when a milestone starts, resolving options from CLI
 * context (slug + milestone number).
 *
 * Returns null when no project ID is found or no LINEAR_API_KEY is set.
 */
export async function cliSyncStart(
  projectDir: string,
  slug: string,
  milestoneNumber: number,
): Promise<MilestoneStartSync | null> {
  const projectId = await resolveLinearProjectId(projectDir, slug);
  if (!projectId) return null;

  // Verify API key is available before resolving milestone name
  try {
    new LinearClient();
  } catch (error) {
    if (error instanceof LinearClientError) {
      console.warn("[linear-sync] WARN: LINEAR_API_KEY not set — skipping Linear sync");
      return null;
    }
    throw error;
  }

  const milestoneName = await resolveMilestoneName(
    projectDir,
    slug,
    milestoneNumber,
  );

  return syncMilestoneStart({
    projectId,
    milestoneNumber,
    milestoneName,
  });
}

// ---------------------------------------------------------------------------
// CLI Sync Complete
// ---------------------------------------------------------------------------

/**
 * Sync Linear state when a milestone completes, resolving options from CLI
 * context (slug + milestone number).
 *
 * Returns null when no project ID is found or no LINEAR_API_KEY is set.
 */
export async function cliSyncComplete(
  projectDir: string,
  slug: string,
  milestoneNumber: number,
  isLastMilestone: boolean,
  prUrl?: string,
): Promise<MilestoneCompleteSync | null> {
  const projectId = await resolveLinearProjectId(projectDir, slug);
  if (!projectId) return null;

  // Verify API key is available before resolving milestone name
  try {
    new LinearClient();
  } catch (error) {
    if (error instanceof LinearClientError) {
      console.warn("[linear-sync] WARN: LINEAR_API_KEY not set — skipping Linear sync");
      return null;
    }
    throw error;
  }

  const milestoneName = await resolveMilestoneName(
    projectDir,
    slug,
    milestoneNumber,
  );

  return syncMilestoneComplete({
    projectId,
    milestoneNumber,
    milestoneName,
    isLastMilestone,
    prUrl,
  });
}

// ---------------------------------------------------------------------------
// CLI Fetch Issue Identifiers
// ---------------------------------------------------------------------------

/**
 * Fetch all Linear issue identifiers for a project, resolving the project ID
 * from the PRD slug. Used to inject `Closes TEAM-XXX` into PR descriptions.
 *
 * Returns null when no project ID is found or no LINEAR_API_KEY is set.
 */
export async function cliFetchIssueIdentifiers(
  projectDir: string,
  slug: string,
): Promise<ProjectIssueIdentifiers | null> {
  const projectId = await resolveLinearProjectId(projectDir, slug);
  if (!projectId) return null;

  try {
    new LinearClient();
  } catch (error) {
    if (error instanceof LinearClientError) {
      console.warn("[linear-sync] WARN: LINEAR_API_KEY not set — skipping Linear sync");
      return null;
    }
    throw error;
  }

  return fetchProjectIssueIdentifiers({ projectId });
}

// ---------------------------------------------------------------------------
// CLI Sync Done
// ---------------------------------------------------------------------------

/**
 * Transition all project issues and the project to "Done" (post-merge).
 * Resolves the project ID from the PRD slug.
 *
 * Returns null when no project ID is found or no LINEAR_API_KEY is set.
 */
export async function cliSyncDone(
  projectDir: string,
  slug: string,
): Promise<ProjectDoneSync | null> {
  const projectId = await resolveLinearProjectId(projectDir, slug);
  if (!projectId) return null;

  try {
    new LinearClient();
  } catch (error) {
    if (error instanceof LinearClientError) {
      console.warn("[linear-sync] WARN: LINEAR_API_KEY not set — skipping Linear sync");
      return null;
    }
    throw error;
  }

  return syncProjectDone({ projectId });
}
