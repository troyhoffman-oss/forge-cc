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
import type {
  CommitOptions,
  CommitResult,
  MilestoneUpdateOptions,
} from "../state/writer.js";
import { buildMilestoneContext } from "./executor.js";
import type { ForgeConfig } from "../types.js";

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
// runAutoChain
// ---------------------------------------------------------------------------

/**
 * Auto-chain orchestrator: manages multi-milestone execution with context resets.
 *
 * For each pending milestone:
 * 1. Determines the starting milestone (from options or STATE.md/ROADMAP.md)
 * 2. Builds a fresh-context prompt for the milestone agent
 * 3. Calls the milestone context builder for structured data
 * 4. Returns results so the calling skill can spawn agents and drive execution
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

  // Loop through milestones until we run out or hit a failure
  while (true) {
    // Build fresh-context prompt for this milestone
    const freshPrompt = await buildFreshSessionPrompt(
      projectDir,
      prdPath,
      currentMilestoneNumber,
    );

    // Build structured context (validates milestone exists in PRD)
    let context;
    try {
      context = await buildMilestoneContext({
        projectDir,
        prdPath,
        milestoneNumber: currentMilestoneNumber,
        config,
      });
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
      isLast: await isLastMilestone(projectDir, currentMilestoneNumber),
      freshPrompt,
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
    const nextPending = await findNextPendingMilestone(projectDir);
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
}

// ---------------------------------------------------------------------------
// completeMilestone — post-execution bookkeeping
// ---------------------------------------------------------------------------

/**
 * Called after a milestone's agent finishes execution.
 *
 * Handles:
 * 1. Updating milestone progress in STATE.md and ROADMAP.md
 * 2. Committing milestone work to git
 * 3. Returning the commit SHA for the milestone result
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
  } = options;

  // Check if this is the last milestone
  const last = await isLastMilestone(projectDir, milestoneNumber);

  // Find next milestone for state docs
  const roadmap = await readRoadmapProgress(projectDir);
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
    projectDir,
    project,
    milestoneNumber,
    milestoneName,
    branch,
    activePrd,
    developer,
    nextMilestone: nextMilestoneInfo,
    milestoneTable,
  });

  // Commit milestone work
  const commitResult = commitMilestoneWork({
    projectDir,
    milestoneNumber,
    milestoneName,
    filesToStage,
    push,
    branch,
  });

  return { commitResult, isLast: last };
}
