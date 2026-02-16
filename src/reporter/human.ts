import type { PipelineResult } from "../types.js";
import type { Session } from "../worktree/session.js";

export function formatHumanReport(result: PipelineResult): string {
  const lines: string[] = [];

  // Header
  const status = result.passed ? "PASSED" : "FAILED";
  lines.push("## Verification Report");
  lines.push(`**Status:** ${status}`);
  lines.push(`**Iterations:** ${result.iteration}/${result.maxIterations}`);

  const totalMs = result.gates.reduce((sum, g) => sum + g.duration_ms, 0);
  lines.push(`**Duration:** ${formatDuration(totalMs)}`);
  lines.push("");

  // Gate results
  lines.push("### Gates");
  for (const gate of result.gates) {
    const icon = gate.passed ? "[x]" : "[ ]";
    const statusText = gate.passed ? "PASS" : "FAIL";
    const dur = formatDuration(gate.duration_ms);

    let suffix = "";
    if (!gate.passed && gate.errors.length > 0) {
      suffix = ` — ${gate.errors.length} error${gate.errors.length === 1 ? "" : "s"}`;
    } else if (gate.passed && gate.warnings.length > 0) {
      suffix = ` — ${gate.warnings.length} warning${gate.warnings.length === 1 ? "" : "s"}`;
    }

    lines.push(`- ${icon} ${gate.gate}: ${statusText} (${dur})${suffix}`);
  }
  lines.push("");

  // Errors section
  const gatesWithErrors = result.gates.filter((g) => g.errors.length > 0);
  if (gatesWithErrors.length > 0) {
    lines.push("### Errors");
    for (const gate of gatesWithErrors) {
      lines.push(`#### ${gate.gate}`);
      for (const err of gate.errors) {
        const loc = err.file
          ? `${err.file}${err.line ? `:${err.line}` : ""}`
          : "";
        const prefix = loc ? `${loc}: ` : "";
        lines.push(`- ${prefix}${err.message}`);
        if (err.remediation) {
          lines.push(`  > Fix: ${err.remediation}`);
        }
      }
      lines.push("");
    }
  }

  // Warnings section
  const gatesWithWarnings = result.gates.filter(
    (g) => g.warnings.length > 0,
  );
  if (gatesWithWarnings.length > 0) {
    lines.push("### Warnings");
    for (const gate of gatesWithWarnings) {
      lines.push(`#### ${gate.gate}`);
      for (const warning of gate.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a human-readable sessions report as a markdown table.
 */
export function formatSessionsReport(sessions: Session[]): string {
  if (sessions.length === 0) {
    return "No active sessions.";
  }

  const lines: string[] = [];
  lines.push("### Active Sessions");
  lines.push(
    "| Session | User | Skill | Milestone | Branch | Status | Duration | Worktree |",
  );
  lines.push(
    "|---------|------|-------|-----------|--------|--------|----------|----------|",
  );

  for (const s of sessions) {
    const shortId = s.id.slice(0, 8);
    const milestone = s.milestone ?? "\u2014";
    const elapsed = Date.now() - new Date(s.startedAt).getTime();
    const duration = formatSessionDuration(elapsed);
    const statusLabel =
      s.status === "stale" ? "stale \u26A0" : s.status;

    lines.push(
      `| ${shortId} | ${s.user} | ${s.skill} | ${milestone} | ${s.branch} | ${statusLabel} | ${duration} | ${s.worktreePath} |`,
    );
  }

  return lines.join("\n");
}

function formatSessionDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}min` : ""}`;
}
