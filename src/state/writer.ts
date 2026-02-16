import { execSync } from "node:child_process";
import { readPRDStatus, updateMilestoneStatus } from "./prd-status.js";

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
  prdSlug: string;
  milestoneNumber: number;
  milestoneName: string;
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
  prdSlug: string,
  milestoneNumber: number,
): Promise<boolean> {
  const status = await readPRDStatus(projectDir, prdSlug);
  if (!status) return true;

  const milestoneNumbers = Object.keys(status.milestones).map((k) =>
    parseInt(k, 10),
  );
  const maxMilestone = Math.max(...milestoneNumbers);

  if (milestoneNumber >= maxMilestone) return true;

  // Check if all milestones after this one are complete
  const remaining = milestoneNumbers.filter(
    (n) =>
      n > milestoneNumber &&
      status.milestones[String(n)].status !== "complete",
  );

  return remaining.length === 0;
}

// ---------------------------------------------------------------------------
// updateMilestoneProgress — marks a milestone as complete in PRD status
// ---------------------------------------------------------------------------

export async function updateMilestoneProgress(
  options: MilestoneUpdateOptions,
): Promise<void> {
  const { projectDir, prdSlug, milestoneNumber } = options;
  await updateMilestoneStatus(projectDir, prdSlug, milestoneNumber, "complete");
}
