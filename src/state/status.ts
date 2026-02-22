import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PRDStatus } from "../types.js";

function statusDir(projectDir: string): string {
  return join(projectDir, ".planning", "status");
}

function statusPath(projectDir: string, slug: string): string {
  return join(statusDir(projectDir), `${slug}.json`);
}

const inlinePrdStatusSchema = z.object({
  project: z.string(),
  slug: z.string(),
  branch: z.string(),
  createdAt: z.string(),
  linearProjectId: z.string().optional(),
  linearTeamId: z.string().optional(),
  milestones: z.record(z.string(), z.object({
    status: z.enum(["pending", "in_progress", "complete"]),
    linearIssueIds: z.array(z.string()).optional(),
    completedAt: z.string().optional(),
  })),
});

/** Read and validate a PRD status file. */
export async function readStatus(
  projectDir: string,
  slug: string,
): Promise<PRDStatus> {
  const raw = await readFile(statusPath(projectDir, slug), "utf-8");
  const json: unknown = JSON.parse(raw);
  return inlinePrdStatusSchema.parse(json);
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
