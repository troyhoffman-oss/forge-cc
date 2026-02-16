// ── Setup Templates ─────────────────────────────────────────────────
// String template functions used by /forge:setup to scaffold project files.

import type { TestingConfig } from "../types.js";

export interface SetupContext {
  projectName: string;
  techStack: string;
  description: string;
  gates: string[];
  date: string;
  testing?: TestingConfig;
}

// ── .forge.json ─────────────────────────────────────────────────────

export function forgeConfigTemplate(ctx: SetupContext): string {
  const config: Record<string, unknown> = {
    gates: ctx.gates,
    maxIterations: 5,
  };
  if (ctx.testing) {
    config.testing = ctx.testing;
  }
  return JSON.stringify(config, null, 2) + "\n";
}

// ── Project CLAUDE.md ───────────────────────────────────────────────

export function claudeMdTemplate(ctx: SetupContext): string {
  const gatesList = ctx.gates.map((g) => `\`${g}\``).join(", ");

  return `# ${ctx.projectName} — Claude Code Instructions

## What This Is
${ctx.description}

**Tech:** ${ctx.techStack}

## Quick Reference

| Action | Command |
|--------|---------|
| Run verification | \`npx forge verify\` |
| Run specific gates | \`npx forge verify --gate ${ctx.gates.join(",")}\` |
| Check status | \`npx forge status\` |
| Build | \`npm run build\` |
| Test | \`npm test\` |

## Code Map

\`\`\`
src/
  (add your project structure here)
\`\`\`

## Key Docs

| File | Purpose |
|------|---------|
| \`.planning/STATE.md\` | Current session state (<80 lines) |
| \`.planning/ROADMAP.md\` | Milestone progress tracker |
| \`tasks/lessons.md\` | Lessons learned (max 10 active) |

## Session Protocol
- **On start:** Read CLAUDE.md → .planning/STATE.md → .planning/ROADMAP.md → tasks/lessons.md
- **When lost:** Re-read planning docs, don't guess from stale context

## Session Protocol END (Mandatory)
1. \`.planning/STATE.md\` — replace, don't append
2. \`.planning/ROADMAP.md\` — check off completed milestones
3. \`tasks/lessons.md\` — add/refine lessons (max 10, promote when full)
4. Commit doc updates to the feature branch

## Execution Rules
- **Plan before building.** Read the PRD before touching code.
- **Verify everything.** Run \`npx forge verify\` after changes land.
- **All changes via PR.** Never commit directly to main.
- **Branch naming:** \`feat/short-description\` or \`fix/short-description\`

## Verification Gates
Active gates: ${gatesList}

## Learned Rules
(none yet)
`;
}

// ── .planning/STATE.md ──────────────────────────────────────────────

export function stateMdTemplate(ctx: SetupContext): string {
  return `# State — ${ctx.projectName}

## Current Status
- **Phase:** Setup complete
- **Active project:** None
- **Branch:** main

## What Was Done
- Initialized forge-cc scaffolding (${ctx.date})
- Created .forge.json, CLAUDE.md, planning docs

## Next Actions
- Run \`/forge:spec\` to create a PRD for the first feature
`;
}

// ── .planning/ROADMAP.md ────────────────────────────────────────────

export function roadmapMdTemplate(ctx: SetupContext): string {
  return `# Roadmap — ${ctx.projectName}

## Projects

| Project | Status | PRD | Milestones |
|---------|--------|-----|------------|
| (none yet) | — | — | — |

## Completed
(none yet)
`;
}

// ── tasks/lessons.md ────────────────────────────────────────────────

export function lessonsMdTemplate(ctx: SetupContext): string {
  return `# Lessons Learned — ${ctx.projectName}

<!-- Max 10 active one-liners. Format: - **[topic]** The rule -->
<!-- When full, promote the most battle-tested to CLAUDE.md ## Learned Rules -->

(none yet)
`;
}

// ── ~/.claude/CLAUDE.md (global, for fresh installs) ────────────────

export function globalClaudeMdTemplate(): string {
  return `# Global Claude Code Instructions

## How to Work
- **Follow instructions exactly.** Skills, CLAUDE.md rules, and workflow steps are tested — execute every step as written, including all AskUserQuestion prompts.
- **Default to action.** Don't ask for confirmation. Plan internally, execute, verify.
- **Iterate on failure.** Fix what breaks. Only stop to ask when truly blocked on missing credentials, ambiguous business requirements, or destructive actions on shared infrastructure.
- **Use agent teams** for non-trivial work (3+ files or 3+ steps).

## Verification
- Never mark complete without proving it works.
- Build and tests must pass. Run them.

## Principles
- Simple changes only. Find root causes. Touch only what's necessary.
`;
}

// ── .gitignore lines ────────────────────────────────────────────────

export function gitignoreForgeLines(): string {
  return `.forge/
`;
}
