import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { readRoadmapProgress } from "./reader.js";

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

// ---------------------------------------------------------------------------
// Types — go execution engine
// ---------------------------------------------------------------------------

export interface CommitOptions {
  projectDir: string;
  milestoneNumber: number;
  milestoneName: string;
  filesToStage: string[]; // specific files to stage (never git add .)
  push?: boolean;
  branch?: string;
}

export interface CommitResult {
  commitSha: string;
  pushed: boolean;
}

export interface MilestoneUpdateOptions {
  projectDir: string;
  project: string;
  milestoneNumber: number;
  milestoneName: string;
  branch: string;
  activePrd: string;
  developer: string;
  nextMilestone?: { number: number; name: string };
  milestoneTable: Array<{ number: number; name: string; status: string }>;
}

// ---------------------------------------------------------------------------
// commitMilestoneWork — commits and optionally pushes milestone work
// ---------------------------------------------------------------------------

export function commitMilestoneWork(options: CommitOptions): CommitResult {
  const {
    projectDir,
    milestoneNumber,
    milestoneName,
    filesToStage,
    push,
    branch,
  } = options;

  if (filesToStage.length === 0) {
    throw new Error(
      "filesToStage must contain at least one file — never use git add .",
    );
  }

  // Check if git is available
  try {
    execSync("git --version", { cwd: projectDir, stdio: "pipe" });
  } catch {
    throw new Error("git is not available on this system. Cannot commit milestone work.");
  }

  // Check for detached HEAD
  try {
    const headRef = execSync("git symbolic-ref HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (!headRef) {
      throw new Error("Detached HEAD detected — cannot commit. Check out a branch first.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Detached HEAD")) {
      throw err;
    }
    // git symbolic-ref fails on detached HEAD with exit code 128
    throw new Error("Detached HEAD detected — cannot commit. Check out a branch first.");
  }

  // Stage only the specified files, skipping files that don't exist
  for (const file of filesToStage) {
    try {
      execSync(`git add ${JSON.stringify(file)}`, {
        cwd: projectDir,
        stdio: "pipe",
      });
    } catch {
      // File may not exist or be outside the repo — skip and continue
      console.warn(`Warning: Could not stage file "${file}" — skipping.`);
    }
  }

  // Commit with a descriptive message
  const commitMessage = `feat: ${milestoneName} (Milestone ${milestoneNumber})`;
  try {
    execSync(`git commit -m ${JSON.stringify(commitMessage)}`, {
      cwd: projectDir,
      stdio: "pipe",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git commit failed: ${msg}`);
  }

  // Read back the commit SHA
  const commitSha = execSync("git rev-parse HEAD", {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim();

  // Optionally push to remote
  let pushed = false;
  if (push && branch) {
    try {
      execSync(`git push origin ${branch}`, {
        cwd: projectDir,
        stdio: "pipe",
      });
      pushed = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: git push failed: ${msg}. Commit was created locally.`);
    }
  }

  return { commitSha, pushed };
}

// ---------------------------------------------------------------------------
// isLastMilestone — detects if this is the final pending milestone
// ---------------------------------------------------------------------------

export async function isLastMilestone(
  projectDir: string,
  milestoneNumber: number,
): Promise<boolean> {
  const roadmap = await readRoadmapProgress(projectDir);
  if (!roadmap || roadmap.milestones.length === 0) {
    return true; // No roadmap data — treat as last by default
  }

  const maxMilestone = Math.max(...roadmap.milestones.map((m) => m.number));

  // If this IS the highest milestone number, it's the last
  if (milestoneNumber >= maxMilestone) {
    return true;
  }

  // If all milestones after this one are already complete, this is effectively last
  const remaining = roadmap.milestones.filter(
    (m) =>
      m.number > milestoneNumber &&
      !m.status.toLowerCase().startsWith("complete"),
  );

  return remaining.length === 0;
}

// ---------------------------------------------------------------------------
// updateMilestoneProgress — updates all state docs after milestone completion
// ---------------------------------------------------------------------------

export async function updateMilestoneProgress(
  options: MilestoneUpdateOptions,
): Promise<void> {
  const {
    projectDir,
    project,
    milestoneNumber,
    milestoneName,
    branch,
    activePrd,
    developer,
    nextMilestone,
    milestoneTable,
  } = options;

  const today = new Date().toISOString().slice(0, 10);

  // 1. Mark this milestone as complete in ROADMAP.md
  await updateRoadmapMilestone(
    projectDir,
    milestoneNumber,
    `Complete (${today})`,
  );

  // 2. Build next actions based on whether there's a next milestone
  const nextActions: string[] = nextMilestone
    ? [
        `Begin Milestone ${nextMilestone.number} — ${nextMilestone.name}`,
        "Read PRD for next milestone scope",
        "Spawn agent team for next milestone",
      ]
    : [
        "All milestones complete — final review and cleanup",
        "Merge feature branch to main",
        "Archive planning docs",
      ];

  // 3. Update STATE.md with current position
  const stateTarget = nextMilestone ?? {
    number: milestoneNumber,
    name: milestoneName,
  };
  await writeStateFile(projectDir, {
    project,
    milestone: stateTarget,
    branch,
    activePrd,
    lastSession: today,
    milestoneTable,
    nextActions,
  });

  // 4. Write session memory for this branch
  await writeSessionMemory(projectDir, branch, {
    date: today,
    developer,
    workingOn: `Milestone ${milestoneNumber} — ${milestoneName}`,
    status: "Complete",
    next: nextMilestone
      ? `Milestone ${nextMilestone.number} — ${nextMilestone.name}`
      : "All milestones complete",
    blockers: "None",
  });
}
