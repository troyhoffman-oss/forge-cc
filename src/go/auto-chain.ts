/**
 * Auto-Chain — Multi-Milestone Execution Orchestrator
 *
 * After a milestone completes, spawns a fresh agent with clean context for the
 * next milestone. Fresh agent reads CLAUDE.md + STATE.md + next milestone section
 * only. Loops until all milestones done or a failure stops the chain.
 *
 * This module is the data/logic layer. It does NOT spawn agents — that is
 * the skill file's job (via Claude Code's Task tool). Auto-chain prepares
 * the context and tracks results across milestones.
 */

import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  readStateFile,
  readRoadmapProgress,
  readCurrentMilestone,
} from "../state/reader.js";
import type { MilestoneProgress } from "../state/reader.js";
import {
  isLastMilestone,
  updateMilestoneProgress,
  commitMilestoneWork,
} from "../state/writer.js";
import type { CommitResult } from "../state/writer.js";
import { buildMilestoneContext } from "./executor.js";
import type { ForgeConfig } from "../types.js";
import {
  createWorktree,
  removeWorktree,
  getRepoRoot,
} from "../worktree/manager.js";
import {
  registerSession,
  deregisterSession,
  updateSessionStatus,
} from "../worktree/session.js";
import { getCurrentUser } from "../worktree/identity.js";
import { buildScheduleFromPRD } from "../worktree/parallel.js";
import type { SchedulerResult } from "../worktree/parallel.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoChainOptions {
  projectDir: string;
  prdPath: string;
  config: ForgeConfig;
  branch: string;
  /** Project name (e.g., "forge-cc") */
  project: string;
  /** Relative PRD path for state docs */
  activePrd: string;
  /** Developer name for session memory */
  developer: string;
  /** Repository root (for worktree operations). Defaults to projectDir. */
  repoRoot?: string;
  /** If not provided, detect from STATE.md */
  startMilestone?: number;
  /** Called when a milestone begins execution */
  onMilestoneStart?: (milestoneNumber: number, name: string) => void;
  /** Called when a milestone finishes (success or failure) */
  onMilestoneComplete?: (
    milestoneNumber: number,
    result: MilestoneResult,
  ) => void;
  /** Called when the entire chain finishes */
  onChainComplete?: (results: MilestoneResult[]) => void;
}

export interface MilestoneResult {
  milestoneNumber: number;
  milestoneName: string;
  success: boolean;
  commitSha?: string;
  isLast: boolean;
  /** Fresh-context prompt for spawning this milestone's agent */
  freshPrompt: string;
  /** Path to the worktree used for execution */
  worktreePath?: string;
  errors: string[];
}

export interface AutoChainResult {
  completed: MilestoneResult[];
  /** true if the chain stopped due to a milestone failure */
  stopped: boolean;
  /** Milestone number where the chain stopped (on failure) */
  stoppedAt?: number;
  /** true if every milestone in the roadmap is complete */
  allComplete: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract the "Quick Context" section from CLAUDE.md.
 *
 * Returns just the abbreviated context block (from "## Quick Context" to the
 * next `##` heading or end of file). Falls back to the first 30 lines of
 * the file if the section header isn't found.
 */
function extractQuickContext(claudeMd: string): string {
  if (!claudeMd) return "";

  const quickMatch = claudeMd.match(
    /##\s*Quick Context\s*\n([\s\S]*?)(?=\n##\s|$)/,
  );
  if (quickMatch) {
    return `## Quick Context\n${quickMatch[1].trim()}`;
  }

  // Fallback: first 30 lines (enough context without bloating the prompt)
  const lines = claudeMd.split("\n").slice(0, 30);
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// buildFreshSessionPrompt
// ---------------------------------------------------------------------------

/**
 * Build the fresh-context prompt for a milestone agent (Ralph Loop pattern).
 *
 * Reads CLAUDE.md (abbreviated to Quick Context), STATE.md content, and the
 * current milestone section from the PRD. The total is kept as small as
 * possible (~200-300 lines) while giving the agent enough context to work.
 */
export async function buildFreshSessionPrompt(
  projectDir: string,
  prdPath: string,
  milestoneNumber: number,
): Promise<string> {
  const [claudeMd, stateInfo, milestoneSection] = await Promise.all([
    safeRead(join(projectDir, "CLAUDE.md")),
    readStateFile(projectDir),
    readCurrentMilestone(prdPath, milestoneNumber),
  ]);

  const lines: string[] = [];

  // 1. Abbreviated CLAUDE.md
  const quickContext = extractQuickContext(claudeMd);
  if (quickContext) {
    lines.push("# Project Context");
    lines.push("");
    lines.push(quickContext);
    lines.push("");
  }

  // 2. STATE.md — current position
  if (stateInfo) {
    lines.push("# Current State");
    lines.push("");
    lines.push(stateInfo.raw.trim());
    lines.push("");
  }

  // 3. Current milestone section from PRD
  if (milestoneSection) {
    lines.push("# Current Milestone");
    lines.push("");
    lines.push(milestoneSection.trim());
    lines.push("");
  } else {
    lines.push(`# Current Milestone`);
    lines.push("");
    lines.push(
      `Milestone ${milestoneNumber} section not found in PRD at ${prdPath}.`,
    );
    lines.push("");
  }

  // 4. Session instructions (minimal)
  lines.push("# Session Instructions");
  lines.push("");
  lines.push(
    "You are executing the milestone described above. Follow the PRD precisely.",
  );
  lines.push("- Run `npx tsc --noEmit` after all changes to verify types.");
  lines.push("- Stage only files you create/modify (never `git add .`).");
  lines.push("- Do not commit — the orchestrator handles commits.");
  lines.push(
    "- On completion, update `.planning/STATE.md` and `.planning/ROADMAP.md`.",
  );
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// findNextPendingMilestone
// ---------------------------------------------------------------------------

/**
 * Find the next pending milestone number from the roadmap.
 *
 * Scans ROADMAP.md for milestones whose status does NOT start with "Complete".
 * Returns the lowest-numbered pending milestone, or null if all are done.
 */
export async function findNextPendingMilestone(
  projectDir: string,
): Promise<MilestoneProgress | null> {
  const roadmap = await readRoadmapProgress(projectDir);
  if (!roadmap || roadmap.milestones.length === 0) {
    return null;
  }

  // Sort by number ascending to get the lowest pending one
  const sorted = [...roadmap.milestones].sort((a, b) => a.number - b.number);

  for (const milestone of sorted) {
    const statusLower = milestone.status.toLowerCase();
    if (
      !statusLower.startsWith("complete") &&
      !statusLower.startsWith("done")
    ) {
      return milestone;
    }
  }

  return null; // All milestones are complete
}

// ---------------------------------------------------------------------------
// countPendingMilestones
// ---------------------------------------------------------------------------

/**
 * Count the number of pending (not complete/done) milestones in the roadmap.
 *
 * Used by `npx forge run` to determine if there are milestones to execute
 * and to detect stalls (pending count should decrease each iteration).
 */
export async function countPendingMilestones(
  projectDir: string,
): Promise<number> {
  const roadmap = await readRoadmapProgress(projectDir);
  if (!roadmap) return 0;
  return roadmap.milestones.filter(
    (m) =>
      !m.status.toLowerCase().startsWith("complete") &&
      !m.status.toLowerCase().startsWith("done"),
  ).length;
}

// ---------------------------------------------------------------------------
// runAutoChain
// ---------------------------------------------------------------------------

/**
 * Auto-chain orchestrator: manages multi-milestone execution with context resets.
 *
 * For each pending milestone:
 * 1. Determines the starting milestone (from options or STATE.md/ROADMAP.md)
 * 2. Creates a git worktree for isolated execution
 * 3. Registers a session in the session registry
 * 4. Builds a fresh-context prompt for the milestone agent
 * 5. Calls the milestone context builder for structured data
 * 6. Returns results so the calling skill can spawn agents and drive execution
 * 7. On completion or failure, deregisters the session and cleans up the worktree
 *
 * The worktree is created ONCE per /forge:go session, not per milestone.
 * All milestones in the chain execute in the same worktree.
 *
 * The chain stops on the first milestone failure, or when all milestones
 * are complete. The caller is responsible for actually executing each
 * milestone (spawning agents, running waves) — this function provides the
 * orchestration loop and context management.
 */
export async function runAutoChain(
  options: AutoChainOptions,
): Promise<AutoChainResult> {
  const {
    projectDir,
    prdPath,
    config,
    branch,
    project,
    activePrd,
    developer,
    onMilestoneStart,
    onMilestoneComplete,
    onChainComplete,
  } = options;

  const completed: MilestoneResult[] = [];

  // Determine starting milestone
  let currentMilestoneNumber: number;
  if (options.startMilestone !== undefined) {
    currentMilestoneNumber = options.startMilestone;
  } else {
    // Auto-detect from STATE.md and ROADMAP.md
    const nextPending = await findNextPendingMilestone(projectDir);
    if (!nextPending) {
      // All milestones are already complete
      const result: AutoChainResult = {
        completed: [],
        stopped: false,
        allComplete: true,
      };
      onChainComplete?.([]);
      return result;
    }
    currentMilestoneNumber = nextPending.number;
  }

  // --- Worktree lifecycle: create once for the entire chain ---
  const repoRoot = options.repoRoot ?? getRepoRoot(projectDir);
  const user = getCurrentUser(projectDir);
  const slug = `${project}-m${currentMilestoneNumber}`;

  const worktreeResult = createWorktree(repoRoot, slug, user.name, {
    baseBranch: branch,
  });
  const { worktreePath, branch: worktreeBranch } = worktreeResult;

  const session = registerSession(repoRoot, {
    user,
    skill: "go",
    milestone: `M${currentMilestoneNumber}`,
    branch: worktreeBranch,
    worktreePath,
  });

  // Use worktree path as the effective project directory for code execution.
  // CLAUDE.md and STATE.md are read from the main projectDir (see buildFreshSessionPrompt),
  // but PRD files and milestone context come from the worktree.
  const effectiveProjectDir = worktreePath;

  try {
    // Loop through milestones until we run out or hit a failure
    while (true) {
      // Update session milestone tracking
      updateSessionStatus(repoRoot, session.id, "active");

      // Build fresh-context prompt: CLAUDE.md/STATE.md from main project,
      // PRD path resolved relative to the worktree
      const effectivePrdPath = join(effectiveProjectDir, prdPath);
      const freshPrompt = await buildFreshSessionPrompt(
        projectDir,
        effectivePrdPath,
        currentMilestoneNumber,
      );

      // Build structured context from the worktree (validates milestone exists in PRD)
      let context;
      try {
        context = await buildMilestoneContext({
          projectDir: effectiveProjectDir,
          prdPath,
          milestoneNumber: currentMilestoneNumber,
          config,
        });
        // Attach worktree path to context
        context.worktreePath = worktreePath;
      } catch (err) {
        // Milestone not found in PRD — chain cannot continue
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        const failResult: MilestoneResult = {
          milestoneNumber: currentMilestoneNumber,
          milestoneName: "Unknown",
          success: false,
          isLast: false,
          freshPrompt,
          worktreePath,
          errors: [errorMessage],
        };

        completed.push(failResult);
        onMilestoneComplete?.(currentMilestoneNumber, failResult);

        const chainResult: AutoChainResult = {
          completed,
          stopped: true,
          stoppedAt: currentMilestoneNumber,
          allComplete: false,
        };
        onChainComplete?.(completed);
        return chainResult;
      }

      // Notify: milestone starting
      onMilestoneStart?.(currentMilestoneNumber, context.milestoneName);

      // Build the milestone result with the fresh prompt.
      // The caller uses `freshPrompt` to spawn an agent, then calls
      // `completeMilestone()` after the agent finishes.
      const milestoneResult: MilestoneResult = {
        milestoneNumber: currentMilestoneNumber,
        milestoneName: context.milestoneName,
        success: true, // Optimistic; caller updates via completeMilestone
        isLast: await isLastMilestone(effectiveProjectDir, currentMilestoneNumber),
        freshPrompt,
        worktreePath,
        errors: [],
      };

      completed.push(milestoneResult);

      // Notify: milestone complete (caller will drive actual execution)
      onMilestoneComplete?.(currentMilestoneNumber, milestoneResult);

      // If this was the last milestone, we're done
      if (milestoneResult.isLast) {
        const chainResult: AutoChainResult = {
          completed,
          stopped: false,
          allComplete: true,
        };
        onChainComplete?.(completed);
        return chainResult;
      }

      // Find the next pending milestone
      const nextPending = await findNextPendingMilestone(effectiveProjectDir);
      if (!nextPending) {
        // All milestones are complete
        const chainResult: AutoChainResult = {
          completed,
          stopped: false,
          allComplete: true,
        };
        onChainComplete?.(completed);
        return chainResult;
      }

      currentMilestoneNumber = nextPending.number;
    }
  } finally {
    // --- Worktree cleanup: always runs, even on error ---
    try {
      deregisterSession(repoRoot, session.id);
    } catch {
      // Non-fatal: best-effort deregistration
    }
    try {
      removeWorktree(repoRoot, worktreePath);
    } catch {
      // Non-fatal: best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// completeMilestone — post-execution bookkeeping
// ---------------------------------------------------------------------------

/**
 * Called after a milestone's agent finishes execution.
 *
 * Handles:
 * 1. Updating milestone progress in STATE.md and ROADMAP.md
 * 2. Committing milestone work to git (in the worktree if one was used)
 * 3. Merging worktree branch into the feature branch (if worktree was used)
 * 4. Returning the commit SHA for the milestone result
 *
 * The caller should update the MilestoneResult with the returned commit info.
 */
export async function completeMilestone(options: {
  projectDir: string;
  project: string;
  milestoneNumber: number;
  milestoneName: string;
  branch: string;
  activePrd: string;
  developer: string;
  filesToStage: string[];
  push?: boolean;
  /** Path to the worktree used for execution. If set, commit happens in the worktree. */
  worktreePath?: string;
  /** Repository root, required when worktreePath is provided (for merge operations). */
  repoRoot?: string;
}): Promise<{ commitResult: CommitResult; isLast: boolean }> {
  const {
    projectDir,
    project,
    milestoneNumber,
    milestoneName,
    branch,
    activePrd,
    developer,
    filesToStage,
    push,
    worktreePath,
    repoRoot,
  } = options;

  // The effective directory for state doc updates and commits:
  // if a worktree was used, commit there; otherwise use projectDir
  const commitDir = worktreePath ?? projectDir;

  // Check if this is the last milestone
  const last = await isLastMilestone(commitDir, milestoneNumber);

  // Find next milestone for state docs
  const roadmap = await readRoadmapProgress(commitDir);
  const milestoneTable = roadmap?.milestones.map((m) => ({
    number: m.number,
    name: m.name,
    status:
      m.number === milestoneNumber
        ? `Complete (${new Date().toISOString().slice(0, 10)})`
        : m.status,
  })) ?? [];

  // Find the next milestone (if any)
  const nextMilestone = last
    ? undefined
    : roadmap?.milestones
        .filter(
          (m) =>
            m.number > milestoneNumber &&
            !m.status.toLowerCase().startsWith("complete"),
        )
        .sort((a, b) => a.number - b.number)[0];

  const nextMilestoneInfo = nextMilestone
    ? { number: nextMilestone.number, name: nextMilestone.name }
    : undefined;

  // Update state docs (STATE.md, ROADMAP.md, session memory)
  await updateMilestoneProgress({
    projectDir: commitDir,
    project,
    milestoneNumber,
    milestoneName,
    branch,
    activePrd,
    developer,
    nextMilestone: nextMilestoneInfo,
    milestoneTable,
  });

  // Commit milestone work (in the worktree if one was used)
  const commitResult = commitMilestoneWork({
    projectDir: commitDir,
    milestoneNumber,
    milestoneName,
    filesToStage,
    push: false, // Don't push from worktree; push happens after merge
    branch,
  });

  // If a worktree was used, merge the worktree branch into the feature branch
  if (worktreePath && repoRoot) {
    const worktreeBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    mergeWorktreeBranch(repoRoot, worktreeBranch, branch);

    // Optionally push the feature branch after merge
    if (push) {
      try {
        execSync(`git push origin ${branch}`, {
          cwd: repoRoot,
          stdio: "pipe",
          encoding: "utf-8",
        });
      } catch {
        // Non-fatal: push failure doesn't invalidate the milestone
      }
    }
  } else if (push) {
    // No worktree — push directly from projectDir (original behavior)
    try {
      execSync(`git push origin ${branch}`, {
        cwd: projectDir,
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch {
      // Non-fatal
    }
  }

  return { commitResult, isLast: last };
}

// ---------------------------------------------------------------------------
// mergeWorktreeBranch — brings worktree commits into the feature branch
// ---------------------------------------------------------------------------

/**
 * Merge worktree branch commits into the target branch.
 * Used after milestone completion to bring worktree work back to the feature branch.
 *
 * Checks out the target branch in the main repo, merges the worktree branch,
 * then returns. The caller is responsible for pushing if desired.
 */
function mergeWorktreeBranch(
  repoRoot: string,
  worktreeBranch: string,
  targetBranch: string,
): void {
  // Ensure we're on the target branch in the main repo
  execSync(`git checkout ${targetBranch}`, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf-8",
  });

  // Merge the worktree branch into the target branch
  execSync(`git merge ${worktreeBranch} --no-edit`, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf-8",
  });
}

// ---------------------------------------------------------------------------
// buildParallelPlan — parallel execution planner
// ---------------------------------------------------------------------------

/**
 * Build a parallel execution plan for all milestones in a PRD.
 *
 * Parses the PRD markdown for milestone definitions and `dependsOn` fields,
 * builds a dependency DAG, and computes parallel execution waves showing
 * which milestones can run simultaneously.
 *
 * If no `dependsOn` fields are found in the PRD, all milestones are treated
 * as roots (no dependencies) and placed in a single wave. This is backward
 * compatible — the caller can process them sequentially by milestone number.
 *
 * @param prdPath - Absolute path to the PRD markdown file
 * @returns The wave schedule showing which milestones can run simultaneously
 * @throws If a dependency cycle is detected or a referenced dependency doesn't exist
 */
export async function buildParallelPlan(
  prdPath: string,
): Promise<SchedulerResult> {
  return buildScheduleFromPRD(prdPath);
}
