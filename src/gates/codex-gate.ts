import { execSync } from "node:child_process";
import type { GateResult, GateError } from "../types.js";
import type { CodexComment } from "../team/types.js";

export interface CodexGateOptions {
  owner: string;
  repo: string;
  prNumber: number;
  pollIntervalMs?: number; // default 60_000
  maxPolls?: number; // default 8
  projectDir?: string; // cwd for gh commands
}

/**
 * Fetch PR review comments using the GitHub CLI.
 * Returns an empty array if the `gh` command fails.
 */
export function fetchPRComments(options: {
  owner: string;
  repo: string;
  prNumber: number;
  projectDir?: string;
}): CodexComment[] {
  const { owner, repo, prNumber, projectDir } = options;

  try {
    const raw = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      { cwd: projectDir, encoding: "utf-8", timeout: 30_000 },
    );

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(
      (c: Record<string, unknown>): CodexComment => ({
        id: c.id as number,
        body: c.body as string,
        path: c.path as string,
        line:
          (c.line as number | null) ??
          (c.original_line as number | null) ??
          undefined,
        resolved: false,
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Filter to only unresolved comments.
 */
export function getUnresolvedComments(comments: CodexComment[]): CodexComment[] {
  return comments.filter((c) => c.resolved === false);
}

/**
 * Format a single comment for human-readable display.
 */
export function formatCommentForFix(comment: CodexComment): string {
  const location = comment.line
    ? `${comment.path}:${comment.line}`
    : comment.path;
  return `**PR Comment #${comment.id}** (${location})\n${comment.body}`;
}

/**
 * Poll for PR comments at a regular interval until unresolved comments appear
 * or the maximum number of polls is reached.
 */
export async function pollForCodexComments(
  options: CodexGateOptions,
): Promise<CodexComment[]> {
  const intervalMs = options.pollIntervalMs ?? 60_000;
  const maxPolls = options.maxPolls ?? 8;

  for (let i = 0; i < maxPolls; i++) {
    // Wait before subsequent polls (first poll is immediate)
    if (i > 0) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    const comments = fetchPRComments({
      owner: options.owner,
      repo: options.repo,
      prNumber: options.prNumber,
      projectDir: options.projectDir,
    });

    const unresolved = getUnresolvedComments(comments);
    if (unresolved.length > 0) {
      return unresolved;
    }
  }

  return [];
}

/**
 * Run the Codex post-PR review gate.
 *
 * This gate is NOT registered in the normal pipeline — it runs after a PR is
 * created and polls for Codex review comments.
 */
export async function runCodexGate(
  options: CodexGateOptions,
): Promise<GateResult> {
  const start = Date.now();
  const errors: GateError[] = [];
  const warnings: string[] = [];

  const unresolvedComments = await pollForCodexComments(options);

  if (unresolvedComments.length === 0) {
    warnings.push(
      "No Codex review comments found (Codex may not be configured)",
    );

    return {
      gate: "codex",
      passed: true,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  }

  for (const comment of unresolvedComments) {
    errors.push({
      file: comment.path,
      line: comment.line,
      message: comment.body,
      remediation: "Address the Codex review comment",
    });
  }

  return {
    gate: "codex",
    passed: false,
    errors,
    warnings,
    duration_ms: Date.now() - start,
  };
}
