import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StateWriteInput {
  project: string;
  milestone: { number: number; name: string };
  branch: string;
  activePrd: string;
  lastSession: string;
  milestoneTable: Array<{ number: number; name: string; status: string }>;
  nextActions: string[];
}

export interface SessionMemoryInput {
  date: string;
  developer: string;
  workingOn: string;
  status: string;
  next: string;
  blockers: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function branchSlug(branch: string): string {
  return branch.replace(/\//g, "-").toLowerCase();
}

// ---------------------------------------------------------------------------
// writeStateFile
// ---------------------------------------------------------------------------

export async function writeStateFile(
  projectDir: string,
  info: StateWriteInput,
): Promise<void> {
  const milestoneRows = info.milestoneTable
    .map((m) => `| ${m.number} | ${m.name} | ${m.status} |`)
    .join("\n");

  const nextActions = info.nextActions
    .map((a, i) => `${i + 1}. ${a}`)
    .join("\n");

  const content = `# ${info.project} — Project State

## Current Position
- **Project:** ${info.project} (build phase)
- **Milestone:** Milestone ${info.milestone.number} — ${info.milestone.name}
- **Branch:** ${info.branch}
- **Active PRD:** \`${info.activePrd}\`
- **Last Session:** ${info.lastSession}

## Milestone Progress
| Milestone | Name | Status |
|-----------|------|--------|
${milestoneRows}

## Next Actions
${nextActions}
`;

  const filePath = join(projectDir, ".planning", "STATE.md");
  await ensureDir(filePath);
  await writeFile(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// updateRoadmapMilestone
// ---------------------------------------------------------------------------

export async function updateRoadmapMilestone(
  projectDir: string,
  milestoneNumber: number,
  status: string,
): Promise<void> {
  const filePath = join(projectDir, ".planning", "ROADMAP.md");
  const raw = await readFile(filePath, "utf-8");

  // Match the specific milestone row and replace its status
  const pattern = new RegExp(
    `^(\\|\\s*${milestoneNumber}\\s*\\|\\s*.+?\\s*\\|)\\s*.+?\\s*\\|`,
    "m",
  );

  const match = raw.match(pattern);
  if (!match) {
    throw new Error(
      `Milestone ${milestoneNumber} not found in ROADMAP.md table`,
    );
  }

  const updated = raw.replace(pattern, `$1 ${status} |`);
  await writeFile(filePath, updated, "utf-8");
}

// ---------------------------------------------------------------------------
// writeSessionMemory
// ---------------------------------------------------------------------------

export async function writeSessionMemory(
  projectDir: string,
  branch: string,
  data: SessionMemoryInput,
): Promise<void> {
  const slug = branchSlug(branch);
  const filePath = join(projectDir, ".claude", "memory", `session-${slug}.md`);

  const content = `# Session State
**Date:** ${data.date}
**Developer:** ${data.developer}
**Branch:** ${branch}
**Working On:** ${data.workingOn}
**Status:** ${data.status}
**Next:** ${data.next}
**Blockers:** ${data.blockers}
`;

  await ensureDir(filePath);
  await writeFile(filePath, content, "utf-8");
}
