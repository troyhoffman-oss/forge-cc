// ── Setup Templates ─────────────────────────────────────────────────
// String template functions used by /forge:setup to scaffold project files.

export interface SetupContext {
  projectName: string;
  techStack: string;
  description: string;
  gates: string[];
  date: string;
}

// ── .forge.json ─────────────────────────────────────────────────────

export function forgeConfigTemplate(ctx: SetupContext): string {
  const config = {
    gates: ctx.gates,
    maxIterations: 5,
  };
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

## Session Protocol END (Mandatory)
1. \`.planning/STATE.md\` — replace, don't append
2. \`.planning/ROADMAP.md\` — check off completed milestones
3. \`tasks/lessons.md\` — add/refine lessons (max 10, promote when full)
4. Commit doc updates to the feature branch

## Execution Rules
- **Plan before building.** Read the PRD before touching code.
- **Delegate immediately.** 3+ files or 3+ steps → spawn agent team.
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

## Autonomous Execution Mode

- **Default to action.** Plan internally, execute immediately, verify results.
- **Use agent teams** for non-trivial work (3+ files or 3+ steps).
- **Don't ask questions** unless truly blocked on: missing credentials, ambiguous business logic, or destructive actions on shared infrastructure. **Exception:** Always honor AskUserQuestion prompts defined in skills — those are workflow inputs, not questions.
- **Make mistakes and iterate.** If something breaks, fix it.
- **Summarize after completion**, not during.

## Session Protocol

Fresh context per phase. Memory lives in the repo, not the conversation.

- **On start:** Read CLAUDE.md → STATE.md → ROADMAP.md → lessons files
- **On finish (MANDATORY — work is not done without these):**
  1. Update \`.planning/STATE.md\` — replace, don't append, <80 lines
  2. Update \`.planning/ROADMAP.md\` — check off completed items
  3. Update \`tasks/lessons.md\` — max 10 one-liners, promote to CLAUDE.md Learned Rules when full (max 15)
  4. Commit and push doc updates on the feature branch
  5. Write handoff summary
- **Fresh sessions preferred** over long sessions with context bloat
- **When lost:** Re-read planning docs rather than guessing from stale context

## Verification (Mandatory)

- Never mark a task complete without proving it works
- Build must pass. Tests must pass. No exceptions.
- Run tests, check logs, demonstrate correctness
- If verification fails, fix it and re-verify

## Lessons System

- **\`tasks/lessons.md\`**: max 10 active one-liners
- **\`CLAUDE.md ## Learned Rules\`**: max 15 permanent one-liners (promoted from lessons.md)
- **When to write:** After any correction, and when agents hit issues

## Core Principles

- **Simplicity First:** Make every change as simple as possible.
- **No Laziness:** Find root causes. No temporary fixes.
- **Minimal Impact:** Changes should only touch what's necessary.
`;
}

// ── .gitignore lines ────────────────────────────────────────────────

export function gitignoreForgeLines(): string {
  return `.forge/
`;
}
