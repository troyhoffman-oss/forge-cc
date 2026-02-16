import { z } from "zod";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const MilestoneStatusSchema = z.object({
  status: z.enum(["pending", "in_progress", "complete"]),
  date: z.string().optional(),
});

export const PRDStatusSchema = z.object({
  project: z.string(),
  slug: z.string(),
  branch: z.string(),
  createdAt: z.string(),
  milestones: z.record(z.string(), MilestoneStatusSchema),
});

export type PRDStatus = z.infer<typeof PRDStatusSchema>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusDir(projectDir: string): string {
  return join(projectDir, ".planning", "status");
}

function statusFilePath(projectDir: string, slug: string): string {
  return join(statusDir(projectDir), `${slug}.json`);
}

// ---------------------------------------------------------------------------
// readPRDStatus
// ---------------------------------------------------------------------------

export async function readPRDStatus(
  projectDir: string,
  slug: string,
): Promise<PRDStatus | null> {
  const filePath = statusFilePath(projectDir, slug);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return PRDStatusSchema.parse(parsed);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// writePRDStatus
// ---------------------------------------------------------------------------

export async function writePRDStatus(
  projectDir: string,
  slug: string,
  status: PRDStatus,
): Promise<void> {
  const filePath = statusFilePath(projectDir, slug);
  await mkdir(dirname(filePath), { recursive: true });
  const content = JSON.stringify(status, null, 2) + "\n";
  await writeFile(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// updateMilestoneStatus
// ---------------------------------------------------------------------------

export async function updateMilestoneStatus(
  projectDir: string,
  slug: string,
  milestoneNumber: number,
  status: "pending" | "in_progress" | "complete",
): Promise<void> {
  const current = await readPRDStatus(projectDir, slug);
  if (!current) {
    throw new Error(`PRD status file not found for slug: ${slug}`);
  }

  const key = String(milestoneNumber);
  const milestoneEntry: MilestoneStatus = { status };

  if (status === "complete") {
    milestoneEntry.date = new Date().toISOString().slice(0, 10);
  }

  current.milestones[key] = milestoneEntry;
  await writePRDStatus(projectDir, slug, current);
}

// ---------------------------------------------------------------------------
// discoverPRDs
// ---------------------------------------------------------------------------

export async function discoverPRDs(
  projectDir: string,
): Promise<Array<{ slug: string; status: PRDStatus }>> {
  const dir = statusDir(projectDir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const results: Array<{ slug: string; status: PRDStatus }> = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const slug = file.replace(/\.json$/, "");
    const status = await readPRDStatus(projectDir, slug);
    if (status) {
      results.push({ slug, status });
    }
  }

  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}

// ---------------------------------------------------------------------------
// findNextPendingMilestone
// ---------------------------------------------------------------------------

export async function findNextPendingMilestone(
  projectDir: string,
  slug: string,
): Promise<{ number: number; status: MilestoneStatus } | null> {
  const prd = await readPRDStatus(projectDir, slug);
  if (!prd) return null;

  const entries = Object.entries(prd.milestones)
    .map(([key, value]) => ({ number: parseInt(key, 10), status: value }))
    .filter((e) => e.status.status === "pending")
    .sort((a, b) => a.number - b.number);

  return entries.length > 0 ? entries[0] : null;
}

// ---------------------------------------------------------------------------
// countPendingMilestones
// ---------------------------------------------------------------------------

export async function countPendingMilestones(
  projectDir: string,
  slug?: string,
): Promise<number> {
  if (slug) {
    const prd = await readPRDStatus(projectDir, slug);
    if (!prd) return 0;
    return Object.values(prd.milestones).filter(
      (m) => m.status === "pending",
    ).length;
  }

  const allPRDs = await discoverPRDs(projectDir);
  let count = 0;
  for (const entry of allPRDs) {
    count += Object.values(entry.status.milestones).filter(
      (m) => m.status === "pending",
    ).length;
  }
  return count;
}
