# forge-cc — Claude Code Instructions

## What This Is
Unified dev workflow tool: CLI verification, enforcement hooks, MCP server, workflow skills (`/forge:triage`, `/forge:spec`, `/forge:go`, `/forge:setup`, `/forge:update`), and Linear lifecycle management. Single npm package.

**Package:** `forge-cc`
**Tech:** TypeScript (ES2022, strict), Node.js, MCP SDK, Commander, Playwright, Zod, Vitest

## Quick Reference

| Action | Command |
|--------|---------|
| Run verification | `npx forge verify` |
| Run specific gates | `npx forge verify --gate types,lint` |
| Check status | `npx forge status` |
| Build | `npm run build` |
| Test | `npm test` |
| Type check | `npx tsc --noEmit` |

## Code Map

```
src/
  cli.ts              # CLI entry — npx forge commands
  server.ts           # MCP server (stdio transport)
  types.ts            # Core types
  gates/              # Verification gates (types, lint, tests, visual, runtime, prd)
  config/             # .forge.json schema + loader
  linear/             # Linear lifecycle (client, projects, milestones, issues)
  hooks/              # Pre-commit enforcement
  reporter/           # Output formatting (human, json)
  state/              # Session state (reader, writer)
  spec/               # /forge:spec engine (scanner, interview, generator, templates)
  go/                 # /forge:go engine (executor, verify-loop, auto-chain, finalize)
  setup/              # /forge:setup templates
skills/               # Skill files (triage, spec, go, setup, update)
hooks/                # Installable hooks (pre-commit, version-check)
```

## Key Docs

| File | Purpose |
|------|---------|
| `.planning/STATE.md` | Current session state (<80 lines) |
| `.planning/ROADMAP.md` | Milestone progress tracker |
| `tasks/lessons.md` | Lessons learned (max 10 active) |

## Session Protocol END (Mandatory)
1. `.planning/STATE.md` — replace, don't append
2. `.planning/ROADMAP.md` — check off completed milestones
3. `tasks/lessons.md` — add/refine lessons (max 10, promote when full)
4. Commit doc updates to the feature branch

## Execution Rules
- **Plan before building.** Read the PRD before touching code.
- **Delegate immediately.** 3+ files or 3+ steps → spawn agent team.
- **Verify everything.** Run `npx tsc --noEmit` after changes land.
- **All changes via PR.** Never commit directly to main.
- **Branch naming:** `feat/short-description` or `fix/short-description`

## Critical Rules
- forge-cc has NO dependency on Flow — must work standalone
- Leave code better than you found it

## Learned Rules
- **[agent staging]** Restage all files at wave boundaries — parallel agents can disrupt each other's git index
- **[old file cleanup]** Delete old files immediately after migration to prevent type conflicts
- **[wave consolidation]** When Wave 1 covers Wave 2 scope, skip redundant agents
- **[cross-agent types]** Inline actual code into downstream agent prompts — never predicted types
- **[between-wave verify]** Run `tsc --noEmit` between every wave, not just at the end
