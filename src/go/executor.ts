/**
 * Milestone Execution Engine
 *
 * Programmatic module that reads a PRD milestone definition, prepares
 * wave-based agent prompts, tracks results, runs verification between
 * waves, and produces structured output.
 *
 * This module does NOT spawn agents — that is the skill file's job
 * (via Claude Code's Task tool). The executor is the data/logic layer.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readCurrentMilestone, readSessionContext } from "../state/reader.js";
import type { SessionContext } from "../state/reader.js";
import { readPRDStatus } from "../state/prd-status.js";
import { runPipeline } from "../gates/index.js";
import { formatHumanReport } from "../reporter/human.js";
import { createTeamConfig, shouldIncludeNotetaker } from "../team/lifecycle.js";
import type { TeamConfig } from "../team/types.js";
import type { ForgeConfig, PipelineInput, PipelineResult } from "../types.js";
import type { Milestone, MilestoneWave } from "../spec/templates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteMilestoneOptions {
  projectDir: string;
  prdPath: string;
  milestoneNumber: number;
  config: ForgeConfig;
  /** PRD slug for per-PRD status tracking */
  prdSlug?: string;
  /** Log prompts but don't run verification (for testing) */
  dryRun?: boolean;
}

export interface AgentPrompt {
  name: string;
  task: string;
  files: string[];
  prompt: string;
}

export interface WaveExecution {
  waveNumber: number;
  agents: AgentPrompt[];
}

export interface AgentResult {
  name: string;
  task: string;
  success: boolean;
  error?: string;
  filesCreated: string[];
  filesModified: string[];
}

export interface WaveResult {
  waveNumber: number;
  agents: AgentResult[];
  verification: PipelineResult | null;
}

export interface ExecutionResult {
  milestoneNumber: number;
  milestoneName: string;
  success: boolean;
  waves: WaveResult[];
  totalFilesCreated: number;
  totalFilesModified: number;
  errors: string[];
}

export interface MilestoneContext {
  milestoneNumber: number;
  milestoneName: string;
  milestoneGoal: string;
  milestoneSection: string;
  waves: MilestoneWave[];
  verificationCommands: string[];
  sessionContext: SessionContext;
  lessons: string;
  claudeMd: string;
  /** Path to the worktree used for isolated execution (if any) */
  worktreePath?: string;
  /** Team configuration for agent team lifecycle (M2 integration) */
  teamConfig?: TeamConfig;
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
 * Parse a milestone section from PRD markdown into structured wave data.
 *
 * The PRD milestone section has this structure:
 * ```
 * ### Milestone N: Name
 * **Assigned To:** ...
 * **Goal:** ...
 *
 * **Wave 1 (N agents parallel):**
 * 1. **agent-name**: task description
 *    - Files: file1, file2
 * ```
 *
 * If a structured Milestone object is available (from templates.ts schema),
 * prefer using it directly. This parser handles the markdown fallback.
 */
function parseMilestoneSection(section: string): {
  name: string;
  goal: string;
  waves: MilestoneWave[];
  verificationCommands: string[];
  maxAgentsPerWave: number;
} {
  // Extract milestone name
  const nameMatch = section.match(
    /###\s*Milestone\s+\d+\s*[:\u2014\u2013-]\s*(.+)/,
  );
  const name = nameMatch ? nameMatch[1].trim() : "Unknown Milestone";

  // Extract goal
  const goalMatch = section.match(/\*\*Goal:\*\*\s*(.+)/);
  const goal = goalMatch ? goalMatch[1].trim() : "";

  // Parse waves
  const waves: MilestoneWave[] = [];
  const wavePattern =
    /\*\*Wave\s+(\d+)\s*[^*]*\*\*:?\s*\n([\s\S]*?)(?=\*\*Wave\s+\d+|\*\*Verification|\*\*Acceptance|$)/g;

  let waveMatch: RegExpExecArray | null;
  while ((waveMatch = wavePattern.exec(section)) !== null) {
    const waveNumber = parseInt(waveMatch[1], 10);
    const waveBody = waveMatch[2];

    const agents: MilestoneWave["agents"][number][] = [];

    // Parse agent entries: "1. **agent-name**: task description"
    const agentPattern =
      /\d+\.\s+\*\*([^*]+)\*\*[:\s]+([^\n]+)\n(?:\s+-\s+(?:Files|Creates|Modifies|Deletes):\s*([^\n]+)\n?)*/g;

    let agentMatch: RegExpExecArray | null;
    while ((agentMatch = agentPattern.exec(waveBody)) !== null) {
      const agentName = agentMatch[1].trim();
      const agentTask = agentMatch[2].trim();

      // Collect all file references from sub-items
      const files: string[] = [];
      const fileLinePattern =
        /\s+-\s+(?:Files|Creates|Modifies|Deletes):\s*([^\n]+)/g;
      const agentBlock = waveBody.slice(
        agentMatch.index,
        agentPattern.lastIndex,
      );
      let fileMatch: RegExpExecArray | null;
      while ((fileMatch = fileLinePattern.exec(agentBlock)) !== null) {
        const fileList = fileMatch[1]
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean);
        files.push(...fileList);
      }

      agents.push({ name: agentName, task: agentTask, files });
    }

    if (agents.length > 0) {
      waves.push({ waveNumber, agents });
    }
  }

  // Parse verification commands
  const verificationCommands: string[] = [];
  const verifySection = section.match(
    /\*\*Verification:\*\*\s*\n```(?:bash)?\s*\n([\s\S]*?)```/,
  );
  if (verifySection) {
    const lines = verifySection[1].split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        verificationCommands.push(trimmed);
      }
    }
  }

  // Compute max agents across all waves for team sizing
  const maxAgentsPerWave = waves.reduce(
    (max, w) => Math.max(max, w.agents.length),
    0,
  );

  return { name, goal, waves, verificationCommands, maxAgentsPerWave };
}

// ---------------------------------------------------------------------------
// Context Building
// ---------------------------------------------------------------------------

/**
 * Build the full context needed to execute a milestone.
 * Reads PRD milestone section, CLAUDE.md, lessons, and per-PRD status JSON.
 */
export async function buildMilestoneContext(
  options: ExecuteMilestoneOptions,
): Promise<MilestoneContext> {
  const { projectDir, prdPath, milestoneNumber } = options;

  // Read session context (milestone section from PRD)
  const sessionContext = await readSessionContext(
    projectDir,
    prdPath,
    milestoneNumber,
    options.prdSlug ?? "unknown",
  );

  const milestoneSection = sessionContext.currentMilestoneSection;
  if (!milestoneSection) {
    throw new Error(
      `Milestone ${milestoneNumber} not found in PRD at ${prdPath}`,
    );
  }

  // Parse the milestone section into structured data
  const parsed = parseMilestoneSection(milestoneSection);

  const prdSlug = options.prdSlug ?? "unknown";

  // Read supporting files and PRD status in parallel
  const [lessons, claudeMd, _prdStatus] = await Promise.all([
    safeRead(join(projectDir, "tasks", "lessons.md")),
    safeRead(join(projectDir, "CLAUDE.md")),
    readPRDStatus(projectDir, prdSlug),
  ]);

  // Build team config based on wave structure
  const builderCount = parsed.maxAgentsPerWave;
  const includeNotetaker = shouldIncludeNotetaker(
    parsed.waves.length,
    parsed.maxAgentsPerWave,
  );
  const teamConfig = createTeamConfig({
    prdSlug,
    milestoneNumber,
    builderCount,
    includeNotetaker,
  });

  return {
    milestoneNumber,
    milestoneName: parsed.name,
    milestoneGoal: parsed.goal,
    milestoneSection,
    waves: parsed.waves,
    verificationCommands: parsed.verificationCommands,
    sessionContext,
    lessons,
    claudeMd,
    teamConfig,
  };
}

// ---------------------------------------------------------------------------
// Agent Prompt Building
// ---------------------------------------------------------------------------

/**
 * Build a prompt for a single agent within a milestone wave.
 *
 * The prompt includes:
 * - The agent's specific task and files
 * - Milestone goal and context
 * - Key existing code (inlined, not just paths)
 * - Lessons from tasks/lessons.md
 * - CLAUDE.md rules (abbreviated)
 */
export function buildAgentPrompt(
  agent: MilestoneWave["agents"][number],
  context: MilestoneContext,
  existingCode?: string,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Agent: ${agent.name}`);
  lines.push("");
  lines.push(
    `You are working on **Milestone ${context.milestoneNumber}: ${context.milestoneName}**.`,
  );
  lines.push("");
  lines.push(`**Milestone Goal:** ${context.milestoneGoal}`);
  lines.push("");

  // Agent-specific task
  lines.push("## Your Task");
  lines.push("");
  lines.push(agent.task);
  lines.push("");

  // Files to create/modify
  if (agent.files.length > 0) {
    lines.push("## Files");
    lines.push("");
    for (const file of agent.files) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  // Inline existing code if provided
  if (existingCode) {
    lines.push("## Existing Code (Reference)");
    lines.push("");
    lines.push(existingCode);
    lines.push("");
  }

  // Lessons
  if (context.lessons) {
    lines.push("## Lessons (Follow These)");
    lines.push("");
    lines.push(context.lessons);
    lines.push("");
  }

  // Rules from CLAUDE.md (abbreviated to key rules only)
  if (context.claudeMd) {
    // Extract just the critical rules section if present
    const rulesMatch = context.claudeMd.match(
      /## Critical Rules\s*\n([\s\S]*?)(?=\n##\s|$)/,
    );
    if (rulesMatch) {
      lines.push("## Rules");
      lines.push("");
      lines.push(rulesMatch[1].trim());
      lines.push("");
    }
  }

  // Team Communication (M2 integration)
  if (context.teamConfig) {
    const teamName = context.teamConfig.teamName;
    lines.push("## Team Communication");
    lines.push("");
    lines.push(`You are part of team **${teamName}**.`);
    lines.push("");
    lines.push("Use the **SendMessage** tool to communicate with teammates:");
    lines.push(
      '- Send a direct message: `{ "type": "message", "recipient": "<name>", "content": "...", "summary": "..." }`',
    );
    lines.push(
      "- Only use broadcast for critical blocking issues that affect all teammates.",
    );
    lines.push(
      "- When your task is complete, send a message to the executive summarizing what you did.",
    );
    lines.push(
      "- If you encounter a blocker, message the executive immediately rather than guessing.",
    );
    lines.push("");

    lines.push("## Subagent Spawning");
    lines.push("");
    lines.push(
      "You may spawn subagents for research or exploration using the **Task** tool:",
    );
    lines.push(
      '- Use `subagent_type: "Explore"` for read-only research tasks (searching code, reading files).',
    );
    lines.push(
      '- Use `subagent_type: "general-purpose"` for tasks that require file edits or shell commands.',
    );
    lines.push(
      "- Always provide a clear, self-contained prompt — subagents do not share your conversation context.",
    );
    lines.push(
      "- Prefer subagents for tasks like: finding usage patterns, reading large files, running diagnostic commands.",
    );
    lines.push("");
  }

  // Verification
  lines.push("## Verification");
  lines.push("");
  lines.push("After completing your work, verify:");
  lines.push("- `npx tsc --noEmit` passes");
  if (context.verificationCommands.length > 0) {
    for (const cmd of context.verificationCommands) {
      lines.push(`- \`${cmd}\``);
    }
  }
  lines.push("");

  // Git rules
  lines.push("## Git Rules");
  lines.push("");
  lines.push(
    "- Stage only the files you created/modified (never use `git add .`)",
  );
  lines.push("- Do not commit — the orchestrator handles commits");
  lines.push(
    "- Use ES module imports with `.js` extension in import paths",
  );
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Wave Execution Preparation
// ---------------------------------------------------------------------------

/**
 * Prepare all waves for execution.
 * Returns structured wave data with agent prompts ready for the skill
 * to pass to Claude Code's Task tool.
 */
export function prepareWaves(
  context: MilestoneContext,
  existingCodeMap?: Map<string, string>,
): WaveExecution[] {
  return context.waves.map((wave) => ({
    waveNumber: wave.waveNumber,
    agents: wave.agents.map((agent) => ({
      name: agent.name,
      task: agent.task,
      files: agent.files,
      prompt: buildAgentPrompt(
        agent,
        context,
        existingCodeMap?.get(agent.name),
      ),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Run forge verification pipeline after a wave completes.
 * Returns the pipeline result with human-readable report.
 */
export async function runWaveVerification(
  options: ExecuteMilestoneOptions,
): Promise<PipelineResult> {
  const { projectDir, config, prdPath } = options;

  // Filter out post-pipeline gates (codex is handled after PR creation, not during waves)
  const waveGates = config.gates?.filter((g) => g !== "codex");

  const pipelineInput: PipelineInput = {
    projectDir,
    gates: waveGates,
    prdPath: config.prdPath ?? prdPath,
    maxIterations: config.maxIterations,
    devServerCommand: config.devServer?.command,
    devServerPort: config.devServer?.port,
  };

  const result = await runPipeline(pipelineInput);

  // Attach human-readable report
  if (!result.report) {
    result.report = formatHumanReport(result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Result Tracking
// ---------------------------------------------------------------------------

/**
 * Create an empty execution result for a milestone.
 */
export function createExecutionResult(
  context: MilestoneContext,
): ExecutionResult {
  return {
    milestoneNumber: context.milestoneNumber,
    milestoneName: context.milestoneName,
    success: false,
    waves: [],
    totalFilesCreated: 0,
    totalFilesModified: 0,
    errors: [],
  };
}

/**
 * Record a completed wave's results into the execution result.
 */
export function recordWaveResult(
  execution: ExecutionResult,
  waveResult: WaveResult,
): ExecutionResult {
  const updatedWaves = [...execution.waves, waveResult];

  let totalCreated = 0;
  let totalModified = 0;
  const allErrors: string[] = [];

  for (const wave of updatedWaves) {
    for (const agent of wave.agents) {
      totalCreated += agent.filesCreated.length;
      totalModified += agent.filesModified.length;
      if (agent.error) {
        allErrors.push(`[${agent.name}] ${agent.error}`);
      }
    }
    if (wave.verification && !wave.verification.passed) {
      const failedGates = wave.verification.gates
        .filter((g) => !g.passed)
        .map((g) => g.gate);
      allErrors.push(
        `Wave ${wave.waveNumber} verification failed: ${failedGates.join(", ")}`,
      );
    }
  }

  // Success = all waves complete + last wave verification passed (if any)
  const lastWave = updatedWaves[updatedWaves.length - 1];
  const lastVerificationPassed =
    lastWave?.verification?.passed ?? true;
  const allAgentsSucceeded = updatedWaves.every((w) =>
    w.agents.every((a) => a.success),
  );
  const success = allAgentsSucceeded && lastVerificationPassed;

  return {
    ...execution,
    waves: updatedWaves,
    success,
    totalFilesCreated: totalCreated,
    totalFilesModified: totalModified,
    errors: allErrors,
  };
}

// ---------------------------------------------------------------------------
// Execution Orchestrator
// ---------------------------------------------------------------------------

/**
 * Execute a single milestone end-to-end.
 *
 * In dryRun mode: builds context and prompts, runs no verification, returns
 * the prepared execution plan.
 *
 * In normal mode: the caller (skill file) should use this module's functions
 * step by step:
 * 1. `buildMilestoneContext()` — read PRD and build context
 * 2. `prepareWaves()` — get agent prompts for each wave
 * 3. For each wave: spawn agents, collect results
 * 4. `runWaveVerification()` — verify after each wave
 * 5. `recordWaveResult()` — track results
 *
 * This `executeMilestone` function is the simplified orchestrator for
 * programmatic/testing use. For real execution, the skill drives each step.
 */
export async function executeMilestone(
  options: ExecuteMilestoneOptions,
): Promise<{
  context: MilestoneContext;
  waves: WaveExecution[];
  result: ExecutionResult;
}> {
  // 1. Build context
  const context = await buildMilestoneContext(options);

  // 2. Prepare waves
  const waves = prepareWaves(context);

  // 3. Create result tracker
  const result = createExecutionResult(context);

  if (options.dryRun) {
    // In dry run, return the plan without executing
    return { context, waves, result };
  }

  // In non-dry-run mode, the executor only runs verification.
  // Agent spawning is the caller's (skill's) responsibility.
  // This path is for programmatic testing only.
  return { context, waves, result };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format an execution result as a human-readable summary.
 */
export function formatExecutionSummary(result: ExecutionResult): string {
  const lines: string[] = [];
  const status = result.success ? "COMPLETE" : "FAILED";

  lines.push(
    `## Milestone ${result.milestoneNumber}: ${result.milestoneName} -- ${status}`,
  );
  lines.push("");

  // Wave summary
  for (const wave of result.waves) {
    const agentStatus = wave.agents
      .map((a) => `${a.name}: ${a.success ? "OK" : "FAIL"}`)
      .join(", ");
    const verifyStatus = wave.verification
      ? wave.verification.passed
        ? "PASSED"
        : "FAILED"
      : "SKIPPED";

    lines.push(
      `**Wave ${wave.waveNumber}:** ${agentStatus} | Verify: ${verifyStatus}`,
    );
  }
  lines.push("");

  // Stats
  lines.push(`**Files Created:** ${result.totalFilesCreated}`);
  lines.push(`**Files Modified:** ${result.totalFilesModified}`);
  lines.push("");

  // Errors
  if (result.errors.length > 0) {
    lines.push("### Errors");
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format verification errors into a structured prompt for fix agents.
 * Used by the self-healing verify loop.
 */
export function formatErrorsForFixAgent(
  verification: PipelineResult,
): string {
  const lines: string[] = [];

  lines.push("## Verification Errors to Fix");
  lines.push("");

  for (const gate of verification.gates) {
    if (gate.passed) continue;

    lines.push(`### ${gate.gate} Gate — FAILED`);
    for (const error of gate.errors) {
      const loc = error.file
        ? `${error.file}${error.line ? `:${error.line}` : ""}`
        : "";
      const prefix = loc ? `**${loc}:** ` : "";
      lines.push(`- ${prefix}${error.message}`);
      if (error.remediation) {
        lines.push(`  > Fix: ${error.remediation}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
