/**
 * Final Milestone Detection and PR Creation
 *
 * Handles the transition from "last milestone complete" to "PR ready for review".
 * Uses `gh pr create` to open a pull request with a forge verification report
 * in the body. Designed to be called by the execution engine after the final
 * milestone passes verification.
 */

import { execSync } from "node:child_process";
import type { PipelineResult, GateResult, CodexComment } from "../types.js";
import {
  pollForCodexComments,
  runCodexGate,
  getUnresolvedComments,
  fetchPRComments,
} from "../gates/codex-gate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePROptions {
  projectDir: string;
  branch: string;
  baseBranch?: string; // default: "main"
  title: string;
  milestones: Array<{ number: number; name: string; success: boolean }>;
  verificationReport?: string; // human-readable forge verify output
  commitSha?: string;
}

export interface PRResult {
  url: string;
  number: number;
  title: string;
  created: boolean;
}

export interface PRError {
  url: "";
  number: 0;
  title: string;
  created: false;
  error: string;
}

// ---------------------------------------------------------------------------
// Codex gate integration types
// ---------------------------------------------------------------------------

export interface FinalizeWithCodexOptions extends CreatePROptions {
  /** GitHub owner/org for the repo */
  owner: string;
  /** GitHub repo name */
  repo: string;
  /** Codex gate poll interval in milliseconds (default: 60_000) */
  codexPollIntervalMs?: number;
  /** Maximum number of poll cycles (default: 8) */
  codexMaxPolls?: number;
  /** Called for each unresolved PR comment; return true if fix was pushed */
  onFixComment?: (comment: CodexComment) => Promise<boolean>;
}

export interface FinalizeResult {
  pr: PRResult | PRError;
  codexGate?: GateResult;
  allCommentsResolved: boolean;
}

// ---------------------------------------------------------------------------
// extractRepoInfo
// ---------------------------------------------------------------------------

/**
 * Extract the owner and repo name from the current Git remote using `gh`.
 * Returns `null` if `gh` is unavailable or the command fails.
 */
export function extractRepoInfo(
  projectDir: string,
): { owner: string; repo: string } | null {
  try {
    const raw = execSync("gh repo view --json owner,name", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 15_000,
    }).trim();

    const parsed = JSON.parse(raw) as { owner: { login: string }; name: string };
    return { owner: parsed.owner.login, repo: parsed.name };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// pollAndResolvePRComments
// ---------------------------------------------------------------------------

/**
 * Poll for Codex review comments on a PR and attempt to resolve them
 * using the provided `onFixComment` callback. Returns the list of
 * comments that remain unresolved after the fix cycle.
 */
export async function pollAndResolvePRComments(options: {
  owner: string;
  repo: string;
  prNumber: number;
  projectDir?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
  onFixComment?: (comment: CodexComment) => Promise<boolean>;
}): Promise<{ unresolved: CodexComment[]; gateResult: GateResult }> {
  const {
    owner,
    repo,
    prNumber,
    projectDir,
    pollIntervalMs,
    maxPolls,
    onFixComment,
  } = options;

  // First pass: poll for comments
  const gateResult = await runCodexGate({
    owner,
    repo,
    prNumber,
    pollIntervalMs,
    maxPolls,
    projectDir,
  });

  // If no errors (gate passed), everything is clean
  if (gateResult.passed) {
    return { unresolved: [], gateResult };
  }

  // If we have no fix callback, just return the unresolved state
  if (!onFixComment) {
    const comments = fetchPRComments({ owner, repo, prNumber, projectDir });
    const unresolved = getUnresolvedComments(comments);
    return { unresolved, gateResult };
  }

  // Attempt to fix each unresolved comment, tracking addressed IDs
  const comments = fetchPRComments({ owner, repo, prNumber, projectDir });
  const addressedIds = new Set<number>();

  for (const comment of comments) {
    await onFixComment(comment);
    addressedIds.add(comment.id);
  }

  // After fixes, do one more poll cycle to check for any NEW comments
  // from a re-review (exclude already-addressed IDs so the loop converges)
  const recheckComments = await pollForCodexComments({
    owner,
    repo,
    prNumber,
    pollIntervalMs: pollIntervalMs ?? 60_000,
    maxPolls: 1,
    projectDir,
    knownIds: addressedIds,
  });

  const stillUnresolved = recheckComments;

  // Build a final gate result reflecting the post-fix state
  const finalGateResult: GateResult = {
    gate: "codex",
    passed: stillUnresolved.length === 0,
    errors: stillUnresolved.map((c) => ({
      file: c.path,
      line: c.line,
      message: c.body,
      remediation: "Address the Codex review comment",
    })),
    warnings:
      stillUnresolved.length === 0
        ? ["All Codex comments resolved after fix cycle"]
        : [],
    duration_ms: gateResult.duration_ms,
  };

  return { unresolved: stillUnresolved, gateResult: finalGateResult };
}

// ---------------------------------------------------------------------------
// finalizeWithCodexGate
// ---------------------------------------------------------------------------

/**
 * Create a PR and run the Codex review gate. The milestone only marks
 * complete when 0 unresolved PR comments remain. If the Codex gate
 * times out with no comments, the milestone still completes (gate is
 * optional).
 */
export async function finalizeWithCodexGate(
  options: FinalizeWithCodexOptions,
): Promise<FinalizeResult> {
  // Step 1: Create the PR
  const pr = createPullRequest(options);

  // If PR creation failed, return early
  if (!pr.created) {
    return { pr, allCommentsResolved: false };
  }

  // Step 2: Run the Codex review gate with pollAndResolve
  const { unresolved, gateResult } = await pollAndResolvePRComments({
    owner: options.owner,
    repo: options.repo,
    prNumber: pr.number,
    projectDir: options.projectDir,
    pollIntervalMs: options.codexPollIntervalMs,
    maxPolls: options.codexMaxPolls,
    onFixComment: options.onFixComment,
  });

  // Codex gate is optional: if it passed (no comments found / timed out),
  // the milestone still completes
  const allCommentsResolved = unresolved.length === 0;

  return {
    pr,
    codexGate: gateResult,
    allCommentsResolved,
  };
}

// ---------------------------------------------------------------------------
// buildPRTitle
// ---------------------------------------------------------------------------

/**
 * Generate a PR title summarizing all completed milestones.
 *
 * Examples:
 * - `feat: my-project — Milestone 1 complete`
 * - `feat: my-project — Milestones 1-5 complete`
 */
export function buildPRTitle(project: string, milestoneCount: number): string {
  if (milestoneCount <= 0) {
    return `feat: ${project} — implementation complete`;
  }

  if (milestoneCount === 1) {
    return `feat: ${project} — Milestone 1 complete`;
  }

  return `feat: ${project} — Milestones 1-${milestoneCount} complete`;
}

// ---------------------------------------------------------------------------
// buildVerificationSection
// ---------------------------------------------------------------------------

/**
 * Format a PipelineResult into a PR-ready verification section.
 *
 * Includes gate-level pass/fail status with error counts and
 * duration information. Designed to be embedded in a PR body.
 */
export function buildVerificationSection(result: PipelineResult): string {
  const lines: string[] = [];

  const status = result.passed ? "PASSED" : "FAILED";
  lines.push(`**Status:** ${status}`);
  lines.push(
    `**Iterations:** ${result.iteration}/${result.maxIterations}`,
  );
  lines.push("");

  // Gate results table
  lines.push("| Gate | Status | Duration | Details |");
  lines.push("|------|--------|----------|---------|");

  for (const gate of result.gates) {
    const statusIcon = gate.passed ? "Pass" : "Fail";
    const duration = `${(gate.duration_ms / 1000).toFixed(1)}s`;

    let details = "";
    if (!gate.passed && gate.errors.length > 0) {
      details = `${gate.errors.length} error${gate.errors.length === 1 ? "" : "s"}`;
    } else if (gate.passed && gate.warnings.length > 0) {
      details = `${gate.warnings.length} warning${gate.warnings.length === 1 ? "" : "s"}`;
    } else if (gate.passed) {
      details = "Clean";
    }

    lines.push(`| ${gate.gate} | ${statusIcon} | ${duration} | ${details} |`);
  }

  lines.push("");

  // Error details (collapsed for readability)
  const failedGates = result.gates.filter(
    (g) => !g.passed && g.errors.length > 0,
  );
  if (failedGates.length > 0) {
    lines.push("<details>");
    lines.push("<summary>Error Details</summary>");
    lines.push("");

    for (const gate of failedGates) {
      lines.push(`**${gate.gate}:**`);
      for (const err of gate.errors) {
        const loc = err.file
          ? `${err.file}${err.line ? `:${err.line}` : ""}`
          : "";
        const prefix = loc ? `\`${loc}\`: ` : "";
        lines.push(`- ${prefix}${err.message}`);
      }
      lines.push("");
    }

    lines.push("</details>");
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// buildPRBody
// ---------------------------------------------------------------------------

/**
 * Assemble the complete PR body from milestones, verification, and metadata.
 */
function buildPRBody(options: CreatePROptions): string {
  const lines: string[] = [];

  // Summary section — milestone checklist
  lines.push("## Summary");
  lines.push("");
  for (const m of options.milestones) {
    const checkbox = m.success ? "[x]" : "[ ]";
    lines.push(`- ${checkbox} M${m.number}: ${m.name}`);
  }
  lines.push("");

  // Verification report section
  lines.push("## Verification Report");
  lines.push("");
  if (options.verificationReport) {
    lines.push(options.verificationReport);
  } else {
    lines.push("_No verification report available._");
  }
  lines.push("");

  // Details section
  lines.push("## Details");
  lines.push(`- **Branch:** ${options.branch}`);
  if (options.commitSha) {
    lines.push(`- **Commit:** ${options.commitSha.slice(0, 8)}`);
  }
  lines.push("");

  // Footer
  lines.push("---");
  lines.push(
    "Generated with [forge-cc](https://github.com/troyhoffman/forge-cc)",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// createPullRequest
// ---------------------------------------------------------------------------

/**
 * Create a GitHub pull request using the `gh` CLI.
 *
 * Builds a structured PR body with milestone status, verification report,
 * and metadata, then calls `gh pr create`. If `gh` is not installed or the
 * command fails, returns a descriptive error result instead of throwing.
 */
export function createPullRequest(
  options: CreatePROptions,
): PRResult | PRError {
  const baseBranch = options.baseBranch ?? "main";
  const body = buildPRBody(options);

  // Check that gh CLI is available
  try {
    execSync("gh --version", { cwd: options.projectDir, stdio: "pipe" });
  } catch {
    return {
      url: "",
      number: 0,
      title: options.title,
      created: false,
      error:
        "GitHub CLI (gh) is not installed or not in PATH. " +
        "Install it from https://cli.github.com/ and run `gh auth login`.",
    };
  }

  // Create the PR
  try {
    // Write body to a temp approach using stdin to avoid shell escaping issues
    const output = execSync(
      `gh pr create --title ${JSON.stringify(options.title)} --base ${JSON.stringify(baseBranch)} --body ${JSON.stringify(body)}`,
      {
        cwd: options.projectDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();

    // gh pr create outputs the PR URL on success
    const url = output.trim();
    const prNumberMatch = url.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

    return {
      url,
      number: prNumber,
      title: options.title,
      created: true,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);

    // Check for common failure modes
    if (message.includes("already exists")) {
      return {
        url: "",
        number: 0,
        title: options.title,
        created: false,
        error: `A pull request already exists for branch '${options.branch}'. Close or merge the existing PR first.`,
      };
    }

    if (
      message.includes("not authenticated") ||
      message.includes("auth login")
    ) {
      return {
        url: "",
        number: 0,
        title: options.title,
        created: false,
        error:
          "GitHub CLI is not authenticated. Run `gh auth login` to authenticate.",
      };
    }

    return {
      url: "",
      number: 0,
      title: options.title,
      created: false,
      error: `Failed to create PR: ${message}`,
    };
  }
}
