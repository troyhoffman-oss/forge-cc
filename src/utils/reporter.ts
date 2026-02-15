import type { GateResult, PipelineResult } from "../types.js";

/**
 * Generates a markdown verification report from pipeline results.
 */
export function generateReport(result: PipelineResult): string {
  const lines: string[] = [];

  // Header
  const status = result.passed ? "PASSED" : "FAILED";
  lines.push("## Verification Report");
  lines.push(`**Status:** ${status}`);
  lines.push(`**Iterations:** ${result.iteration}/${result.maxIterations}`);

  // Total duration
  const totalMs = result.gates.reduce((sum, g) => sum + g.duration_ms, 0);
  lines.push(`**Total Duration:** ${formatDuration(totalMs)}`);
  lines.push("");

  // Gate Results
  lines.push("### Gate Results");
  for (const gate of result.gates) {
    const checkbox = gate.passed ? "[x]" : "[ ]";
    const statusText = gate.passed ? "PASS" : "FAIL";
    const duration = formatDuration(gate.duration_ms);

    // Build suffix from first warning or error count
    let suffix = "";
    if (!gate.passed && gate.errors.length > 0) {
      suffix = ` — ${gate.errors.length} error${gate.errors.length === 1 ? "" : "s"}`;
    } else if (gate.passed && gate.warnings.length > 0) {
      suffix = ` — ${gate.warnings.length} warning${gate.warnings.length === 1 ? "" : "s"}`;
    }

    lines.push(`- ${checkbox} ${gate.gate}: ${statusText} (${duration})${suffix}`);
  }
  lines.push("");

  // Errors section (only if there are any)
  const gatesWithErrors = result.gates.filter((g) => g.errors.length > 0);
  if (gatesWithErrors.length > 0) {
    lines.push("### Errors");
    for (const gate of gatesWithErrors) {
      lines.push(`#### ${gate.gate}`);
      for (const error of gate.errors) {
        lines.push(`- ${error}`);
      }
      lines.push("");
    }
  }

  // Warnings section (only if there are any)
  const gatesWithWarnings = result.gates.filter((g) => g.warnings.length > 0);
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

/**
 * Format milliseconds as seconds with 1 decimal place.
 */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
