import { readFile, readdir, rename, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PRDStatus } from "../types.js";

const milestoneStatusSchema = z.object({
  status: z.enum(["pending", "in_progress", "complete"]),
  linearIssueIds: z.array(z.string()).optional(),
  completedAt: z.string().optional(),
});

export const prdStatusSchema = z.object({
  project: z.string(),
  slug: z.string(),
  branch: z.string(),
  createdAt: z.string(),
  linearProjectId: z.string().optional(),
  linearTeamId: z.string().optional(),
  milestones: z.record(z.string(), milestoneStatusSchema),
});

function statusDir(projectDir: string): string {
  return join(projectDir, ".planning", "status");
}

function statusPath(projectDir: string, slug: string): string {
  return join(statusDir(projectDir), `${slug}.json`);
}

/** Read and validate a PRD status file. */
export async function readStatus(
  projectDir: string,
  slug: string,
): Promise<PRDStatus> {
  const raw = await readFile(statusPath(projectDir, slug), "utf-8");
  const json: unknown = JSON.parse(raw);
  return prdStatusSchema.parse(json);
}

/** Write a PRD status file atomically (temp file + rename). */
export async function writeStatus(
  projectDir: string,
  slug: string,
  status: PRDStatus,
): Promise<void> {
  const dir = statusDir(projectDir);
  await mkdir(dir, { recursive: true });
  const target = statusPath(projectDir, slug);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(status, null, 2), "utf-8");
  await rename(temp, target);
}

/** Update a single milestone's status within a PRD status file. */
export async function updateMilestoneStatus(
  projectDir: string,
  slug: string,
  milestone: string,
  newStatus: "pending" | "in_progress" | "complete",
): Promise<PRDStatus> {
  const status = await readStatus(projectDir, slug);
  if (!status.milestones[milestone]) {
    status.milestones[milestone] = { status: newStatus };
  } else {
    status.milestones[milestone].status = newStatus;
  }
  if (newStatus === "complete") {
    status.milestones[milestone].completedAt = new Date().toISOString();
  }
  await writeStatus(projectDir, slug, status);
  return status;
}

/** Discover all valid PRD status files in .planning/status/. */
export async function discoverStatuses(
  projectDir: string,
): Promise<PRDStatus[]> {
  const dir = statusDir(projectDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const statuses: PRDStatus[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, entry), "utf-8");
      const json: unknown = JSON.parse(raw);
      const parsed = prdStatusSchema.parse(json);
      statuses.push(parsed);
    } catch {
      // skip invalid files
    }
  }
  return statuses;
}

/** Find the first pending milestone in each PRD. */
export function findNextPending(
  statuses: PRDStatus[],
): Array<{ slug: string; milestone: string; status: PRDStatus }> {
  const results: Array<{ slug: string; milestone: string; status: PRDStatus }> = [];
  for (const status of statuses) {
    const milestoneKeys = Object.keys(status.milestones);
    for (const key of milestoneKeys) {
      if (status.milestones[key].status === "pending") {
        results.push({ slug: status.slug, milestone: key, status });
        break;
      }
    }
  }
  return results;
}
