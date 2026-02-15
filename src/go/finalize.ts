/**
 * Final Milestone Detection and PR Creation
 *
 * Handles the transition from "last milestone complete" to "PR ready for review".
 * Uses `gh pr create` to open a pull request with a forge verification report
 * in the body. Designed to be called by the execution engine after the final
 * milestone passes verification.
 */

import { execSync } from "node:child_process";
import type { PipelineResult } from "../types.js";

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
