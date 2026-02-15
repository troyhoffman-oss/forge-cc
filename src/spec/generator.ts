import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { validatePRD } from "./templates.js";
import type { PRDData, Milestone, UserStory } from "./templates.js";

// ── Section Generators ───────────────────────────────────────────────

function renderHeader(data: PRDData): string {
  const lines = [
    `# ${data.project} — Specification`,
    "",
    `**Project:** ${data.project}`,
    `**Status:** ${data.status}`,
    `**Branch:** ${data.branch}`,
    `**Created:** ${data.created}`,
    `**Assigned To:** ${data.assignedTo}`,
  ];
  if (data.linearProject) {
    lines.push(`**Linear Project:** ${data.linearProject}`);
  }
  return lines.join("\n");
}

function renderOverview(overview: string): string {
  return `## Overview\n\n${overview}`;
}

function renderProblemStatement(problemStatement: string): string {
  return `## Problem Statement\n\n${problemStatement}`;
}

function renderScope(scope: PRDData["scope"]): string {
  const sections: string[] = ["## Scope"];

  sections.push("\n### In Scope");
  for (const item of scope.inScope) {
    sections.push(`- ${item}`);
  }

  sections.push("\n### Out of Scope");
  for (const item of scope.outOfScope) {
    sections.push(`- ${item}`);
  }

  sections.push("\n### Sacred / Do NOT Touch");
  for (const item of scope.sacred) {
    sections.push(`- ${item}`);
  }

  return sections.join("\n");
}

function renderUserStory(story: UserStory): string {
  const lines = [
    `### US-${story.id}: ${story.title}`,
    `**Description:** ${story.description}`,
    "**Acceptance Criteria:**",
  ];
  for (const criterion of story.acceptanceCriteria) {
    lines.push(`- [ ] ${criterion}`);
  }
  return lines.join("\n");
}

function renderUserStories(stories: UserStory[]): string {
  const sections = ["## User Stories", ""];
  for (const story of stories) {
    sections.push(renderUserStory(story));
    sections.push("");
  }
  return sections.join("\n").trimEnd();
}

function renderTechnicalDesign(
  design: PRDData["technicalDesign"]
): string {
  const sections = ["## Technical Design"];

  if (design.projectStructure) {
    sections.push(`\n### Project Structure\n${design.projectStructure}`);
  }

  if (design.keyTypes) {
    sections.push(`\n### Key Types\n${design.keyTypes}`);
  }

  if (design.dependencies && design.dependencies.length > 0) {
    sections.push("\n### Dependencies");
    for (const dep of design.dependencies) {
      sections.push(`- ${dep}`);
    }
  }

  if (design.existingCode) {
    sections.push(`\n### Existing Code\n${design.existingCode}`);
  }

  return sections.join("\n");
}

function renderMilestone(milestone: Milestone): string {
  const lines = [
    `### Milestone ${milestone.number}: ${milestone.name}`,
    `**Assigned To:** ${milestone.assignedTo}`,
    `**Goal:** ${milestone.goal}`,
    "",
  ];

  for (const wave of milestone.waves) {
    const agentCount = wave.agents.length;
    lines.push(
      `**Wave ${wave.waveNumber} (${agentCount} agent${agentCount !== 1 ? "s" : ""} parallel):**`
    );

    for (let i = 0; i < wave.agents.length; i++) {
      const agent = wave.agents[i];
      lines.push(`${i + 1}. **${agent.name}**: ${agent.task}`);
      if (agent.files.length > 0) {
        lines.push(`   - Files: ${agent.files.join(", ")}`);
      }
    }
    lines.push("");
  }

  if (milestone.verificationCommands.length > 0) {
    lines.push("**Verification:**");
    lines.push("```bash");
    for (const cmd of milestone.verificationCommands) {
      lines.push(cmd);
    }
    lines.push("```");
  }

  return lines.join("\n");
}

function renderMilestones(milestones: Milestone[]): string {
  const sections = ["## Implementation Milestones", ""];
  for (const milestone of milestones) {
    sections.push(renderMilestone(milestone));
    sections.push("");
    sections.push("---");
    sections.push("");
  }
  // Remove trailing separator
  if (sections.length > 2) {
    sections.pop(); // empty line
    sections.pop(); // ---
  }
  return sections.join("\n").trimEnd();
}

function renderVerification(verification: PRDData["verification"]): string {
  const sections = ["## Verification"];

  sections.push("\n### Per-Milestone");
  for (const item of verification.perMilestone) {
    sections.push(`- ${item}`);
  }

  sections.push("\n### Overall");
  for (const item of verification.overall) {
    sections.push(`- ${item}`);
  }

  return sections.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Generates a complete PRD markdown document from validated PRD data.
 */
export function generatePRD(data: PRDData): string {
  const sections = [
    renderHeader(data),
    renderOverview(data.overview),
    renderProblemStatement(data.problemStatement),
    renderScope(data.scope),
    renderUserStories(data.userStories),
    renderTechnicalDesign(data.technicalDesign),
    renderMilestones(data.milestones),
    renderVerification(data.verification),
  ];

  return sections.join("\n\n") + "\n";
}

/**
 * Generates a partial PRD from incomplete data (for incremental updates during interview).
 * Fills missing fields with placeholders.
 */
export function generateDraftPRD(data: Partial<PRDData>): string {
  const sections: string[] = [];

  // Header — always present
  const project = data.project ?? "Untitled Project";
  const headerLines = [
    `# ${project} — Specification`,
    "",
    `**Project:** ${project}`,
    `**Status:** ${data.status ?? "Draft"}`,
    `**Branch:** ${data.branch ?? "TBD"}`,
    `**Created:** ${data.created ?? new Date().toISOString().split("T")[0]}`,
    `**Assigned To:** ${data.assignedTo ?? "TBD"}`,
  ];
  if (data.linearProject) {
    headerLines.push(`**Linear Project:** ${data.linearProject}`);
  }
  sections.push(headerLines.join("\n"));

  if (data.overview) {
    sections.push(renderOverview(data.overview));
  }

  if (data.problemStatement) {
    sections.push(renderProblemStatement(data.problemStatement));
  }

  if (data.scope) {
    sections.push(renderScope(data.scope));
  }

  if (data.userStories && data.userStories.length > 0) {
    sections.push(renderUserStories(data.userStories));
  }

  if (data.technicalDesign) {
    sections.push(renderTechnicalDesign(data.technicalDesign));
  }

  if (data.milestones && data.milestones.length > 0) {
    sections.push(renderMilestones(data.milestones));
  }

  if (data.verification) {
    sections.push(renderVerification(data.verification));
  }

  return sections.join("\n\n") + "\n";
}

/**
 * Validates PRD data, generates markdown, and writes to disk.
 */
export function writePRDToFile(data: PRDData, outputPath: string): void {
  const validated = validatePRD(data);
  const markdown = generatePRD(validated);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, "utf-8");
}
