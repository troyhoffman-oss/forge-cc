import type { PipelineResult } from "../types.js";

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
