import type { PipelineResult } from "../types.js";
import type { Requirement } from "../graph/types.js";

/** Format PipelineResult errors into a human-readable string. */
function formatVerifyErrors(result: PipelineResult): string {
  const lines: string[] = [`forge verify: ${result.result}`];
  for (const gate of result.gates) {
    if (!gate.passed) {
      lines.push(`\nGate "${gate.gate}" FAILED:`);
      for (const err of gate.errors) {
        const loc = err.column
          ? `${err.file}:${err.line}:${err.column}`
          : `${err.file}:${err.line}`;
        const rule = err.rule ? ` [${err.rule}]` : "";
        lines.push(`  ${loc} — ${err.message}${rule}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Build a prompt for the graph-based Ralph loop.
 * Takes pre-loaded data — does NOT read disk.
 */
export function buildRequirementPrompt(opts: {
  requirement: Requirement;
  overview: string;
  depContext: Requirement[];
  verifyErrors?: PipelineResult | null;
}): string {
  const { requirement, overview, depContext, verifyErrors } = opts;

  const currentState =
    verifyErrors && verifyErrors.result === "FAILED"
      ? formatVerifyErrors(verifyErrors)
      : "First iteration — start from scratch";

  const depsSection =
    depContext.length > 0
      ? `## Completed Dependencies\n\n${depContext.map((dep) => `### ${dep.id}: ${dep.title}\n${dep.body}`).join("\n\n")}\n\n`
      : "";

  const filesCreates = requirement.files.creates.join(", ") || "none";
  const filesModifies = requirement.files.modifies.join(", ") || "none";

  return `# Task: Complete Requirement ${requirement.id} — ${requirement.title}

## Project Overview
${overview}

${depsSection}## Your Requirement
${requirement.body}

### Acceptance Criteria
${requirement.acceptance.map((a) => `- ${a}`).join("\n")}

### File Scope
**Creates:** ${filesCreates}
**Modifies:** ${filesModifies}

## Current State
${currentState}

## Rules
- Run \`npx forge verify\` before finishing. All gates must pass.
- Commit your work before exiting.
- Do NOT create tests just to make gates pass. Fix real issues only.
- Stay within the declared file scope when possible.`;
}
