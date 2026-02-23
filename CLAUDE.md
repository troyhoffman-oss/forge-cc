# forge-cc — Claude Code Instructions

## What This Is
Unified dev workflow tool: CLI verification, enforcement hooks, graph-based workflow skills (`/forge:capture`, `/forge:plan`, `/forge:build`, `/forge:fix`, `/forge:quick`, `/forge:setup`, `/forge:update`), and Linear lifecycle management. Single npm package.

**Package:** `forge-cc` **v2.0.2**
**Tech:** TypeScript (ES2022, strict), Node.js, Commander, Playwright, Zod, Vitest

## Quick Reference

| Action | Command |
|--------|---------|
| Run verification | `npx forge verify` |
| Run specific gates | `npx forge verify --gate types,lint` |
| Check status | `npx forge status` |
| Clean stale sessions | `npx forge cleanup` |
| Execute graph | `npx forge run --prd <slug>` |
| Build | `npm run build` |
| Test | `npm test` |
| Type check | `npx tsc --noEmit` |

## Code Map

```
src/
  cli.ts              # CLI entry — npx forge commands (verify, status, setup, update, cleanup, run)
  types.ts            # Core types
  gates/              # Verification gates (types, lint, tests)
  config/             # .forge.json schema + loader
  graph/              # Requirement graph engine (index, query, reader, writer, validator, schemas)
  linear/             # Linear lifecycle (client, sync)
  runner/             # Graph-based runner (loop, prompt, detect, update)
  state/              # Session state (status, cache)
  setup.ts            # /forge:setup engine
  doctor.ts           # Diagnostics
  worktree/           # Git worktree manager
skills/               # Skill files (capture, plan, build, fix, quick, setup, update)
  ref/                # Reference docs (adversarial-review, requirement-sizing, graph-correction)
hooks/                # Installable hooks (pre-commit, version-check)
```

## Workflow

1. **`/forge:capture`** — Brain dump → Linear projects and issues
2. **`/forge:plan`** — Interview → requirement graph (`.planning/graph/{slug}/`)
3. **`/forge:build`** — Execute requirement graph with adversarial review
4. **`/forge:fix`** — Surgical recovery for failed requirements
5. **`/forge:quick`** — Ad-hoc tasks without planning ceremony

## Key Docs

| File | Purpose |
|------|---------|
| `.planning/graph/{slug}/_index.yaml` | Requirement graph index |
| `.planning/graph/{slug}/overview.md` | Project overview |
| `.planning/graph/{slug}/req-*.md` | Individual requirement files |
| `tasks/lessons.md` | Lessons learned (max 10 active) |

## Session Protocol
- **On start:** Read CLAUDE.md → .planning/graph/*/_index.yaml → tasks/lessons.md
- **When lost:** Re-read planning docs, don't guess from stale context

## Session Protocol END (Mandatory)
1. Update graph status via `writeIndex()` if applicable
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
- **[forge-cc global path on Windows]** Use `process.env.APPDATA + '/npm/node_modules/forge-cc'` to locate the global install. Bash can't handle the Windows path (`\n` in `npm\node_modules` breaks). Use `node -e` for forge-cc file operations, never raw bash.
