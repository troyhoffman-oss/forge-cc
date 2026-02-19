import { readFile } from "node:fs/promises";
import type { PipelineResult } from "../types.js";

/**
 * Extract a milestone section from a PRD markdown file.
 * Looks for `### Milestone {N}:` and returns everything up to
 * the next `### Milestone` header or end of file.
 */
export async function readMilestoneSection(
  prdPath: string,
  milestoneNumber: number,
): Promise<string> {
  const content = await readFile(prdPath, "utf-8");
  const pattern = new RegExp(
    `^### Milestone ${milestoneNumber}\\b[^\n]*`,
    "m",
  );
  const match = pattern.exec(content);
  if (!match) {
    throw new Error(
      `Milestone ${milestoneNumber} not found in ${prdPath}`,
    );
  }

  const startIndex = match.index;
  // Find the next ### Milestone header after our match
  const rest = content.slice(startIndex + match[0].length);
  const nextHeader = /^### Milestone \d+/m.exec(rest);
  const section = nextHeader
    ? content.slice(startIndex, startIndex + match[0].length + nextHeader.index)
    : content.slice(startIndex);

  return section.trimEnd();
}

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

/** Build the full Ralph loop prompt for a milestone iteration. */
export function buildPrompt(opts: {
  milestoneName: string;
  milestoneNumber: number;
  milestoneSection: string;
  verifyErrors?: PipelineResult | null;
}): string {
  const { milestoneName, milestoneNumber, milestoneSection, verifyErrors } =
    opts;

  const currentState =
    verifyErrors && verifyErrors.result === "FAILED"
      ? formatVerifyErrors(verifyErrors)
      : "First iteration — start from scratch";

  return `# Task: Complete Milestone ${milestoneNumber} — ${milestoneName}

## What to build
${milestoneSection}

## Current state
${currentState}

## Rules
- Run \`npx forge verify\` before finishing. All gates must pass.
- Commit your work before exiting.
- Do NOT create tests just to make gates pass. Fix real issues only.`;
}
