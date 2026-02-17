# forge-cc — Claude Code Instructions

## What This Is
Unified dev workflow tool: CLI verification, enforcement hooks, MCP server, workflow skills (`/forge:triage`, `/forge:spec`, `/forge:go`, `/forge:setup`, `/forge:update`), and Linear lifecycle management. Single npm package.

**Package:** `forge-cc` **v0.1.24**
**Tech:** TypeScript (ES2022, strict), Node.js, MCP SDK, Commander, Playwright, Zod, Vitest

## Quick Reference

| Action | Command |
|--------|---------|
| Run verification | `npx forge verify` |
| Run specific gates | `npx forge verify --gate types,lint` |
| Check status | `npx forge status` |
| Clean stale sessions | `npx forge cleanup` |
| Auto-chain milestones | `npx forge run` |
| Build | `npm run build` |
| Test | `npm test` |
| Type check | `npx tsc --noEmit` |

## Code Map

```
src/
  cli.ts              # CLI entry — npx forge commands (verify, status, setup, update, cleanup)
  server.ts           # MCP server (stdio transport)
  types.ts            # Core types
  gates/              # Verification gates (types, lint, tests, visual, runtime, prd)
  config/             # .forge.json schema + loader
  linear/             # Linear lifecycle (client, projects, milestones, issues)
  hooks/              # Pre-commit enforcement
  reporter/           # Output formatting (human, json, sessions)
  state/              # Session state (reader, writer)
  spec/               # /forge:spec engine (scanner, interview, generator, templates)
  go/                 # /forge:go engine (executor, verify-loop, auto-chain, finalize)
  setup/              # /forge:setup templates
  worktree/           # Git worktree manager, session registry, state merge, parallel scheduler
  utils/              # Platform utilities (atomic writes, path normalization, shell quoting)
skills/               # Skill files (triage, spec, go, setup, update)
hooks/                # Installable hooks (pre-commit, version-check)
```

## Key Docs

| File | Purpose |
|------|---------|
| `.planning/status/<slug>.json` | Per-PRD milestone status |
| `tasks/lessons.md` | Lessons learned (max 10 active) |

## Session Protocol
- **On start:** Read CLAUDE.md → .planning/status/*.json → tasks/lessons.md
- **When lost:** Re-read planning docs, don't guess from stale context

## Session Protocol END (Mandatory)
1. `.planning/status/<slug>.json` — update milestone status
2. `tasks/lessons.md` — add/refine lessons (max 10, promote when full)
3. Commit doc updates to the feature branch

## Execution Rules
- **Plan before building.** Read the PRD before touching code.
- **Verify everything.** Run `npx tsc --noEmit` after changes land.
- **All changes via PR.** Never commit directly to main.
- **Branch naming:** `feat/short-description` or `fix/short-description`

## Learned Rules
- **[agent staging]** Restage all files at wave boundaries — parallel agents can disrupt each other's git index
- **[old file cleanup]** Delete old files immediately after migration to prevent type conflicts
- **[wave consolidation]** When Wave 1 covers Wave 2 scope, skip redundant agents
- **[cross-agent types]** Inline actual code into downstream agent prompts — never predicted types
- **[between-wave verify]** Run `tsc --noEmit` between every wave, not just at the end
