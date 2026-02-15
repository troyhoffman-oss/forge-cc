# forge-cc -- Claude Code Instructions

## What This Is
Unified dev workflow tool: CLI verification (`npx forge verify`), enforcement hooks, MCP server, workflow skills (`/forge:triage`, `/forge:spec`, `/forge:go`), and Linear lifecycle management. Single npm package, no external dependencies on Flow.

**Package:** `forge-cc` v0.1.0
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

## Key Docs

| File | Purpose |
|------|---------|
| `README.md` | Full documentation -- getting started, config, all features |
| `AGENTS.md` | Minimal instructions for non-Claude agents |
| `.planning/prds/forge-build.md` | Build PRD with milestones and acceptance criteria |
| `.planning/STATE.md` | Current session state (replace, don't append, <80 lines) |
| `.planning/ROADMAP.md` | Milestone progress tracker |
| `tasks/lessons.md` | Lessons learned (max 10 active) |

## Code Map

```
src/
  cli.ts                # CLI entry -- `npx forge` commands (verify, status)
  server.ts             # MCP server -- registers gates as tools (stdio transport)
  types.ts              # Core types: GateResult, PipelineInput, ForgeConfig, VerifyCache

  gates/                # Verification gates
    index.ts            # Gate registry + pipeline runner (runPipeline)
    types-gate.ts       # tsc --noEmit
    lint-gate.ts        # biome check
    tests-gate.ts       # npm run test
    visual-gate.ts      # Playwright screenshots + console errors
    runtime-gate.ts     # HTTP endpoint validation
    prd-gate.ts         # Diff vs PRD acceptance criteria

  config/               # Configuration
    schema.ts           # .forge.json Zod schema (forgeConfigSchema)
    loader.ts           # Config loading + auto-detection from package.json

  linear/               # Linear lifecycle
    client.ts           # GraphQL client
    projects.ts         # Project CRUD + status transitions
    milestones.ts       # Milestone management
    issues.ts           # Issue CRUD + status transitions

  hooks/                # Enforcement
    pre-commit.ts       # Pre-commit check logic (branch, cache, freshness)

  reporter/             # Output formatting
    human.ts            # Markdown report
    json.ts             # Structured JSON

  state/                # Session state
    reader.ts           # Read STATE.md, ROADMAP.md, PRD
    writer.ts           # Update STATE.md, commit + push

  spec/                 # /forge:spec engine
    scanner.ts          # Codebase scanning (structure, patterns, deps)
    interview.ts        # Adaptive interview loop
    generator.ts        # PRD generation
    templates.ts        # PRD templates
    linear-sync.ts      # Spec -> Linear sync (milestones, issues)

  go/                   # /forge:go engine
    executor.ts         # Wave-based milestone execution
    verify-loop.ts      # Self-healing verification loop
    auto-chain.ts       # Multi-milestone chaining (--auto)
    finalize.ts         # PR creation
    linear-sync.ts      # Go -> Linear sync (status transitions)

skills/                 # Claude Code skill files
  forge-triage.md       # /forge:triage -- brain dump to Linear projects
  forge-spec.md         # /forge:spec -- interview to PRD + milestones
  forge-go.md           # /forge:go -- execute milestones with agent teams

hooks/                  # Installable hook files
  pre-commit-verify.js  # Claude Code PreToolUse hook
```

## Session Protocol

### START (Every Session)
1. Read `CLAUDE.md` (this file)
2. Read `.planning/STATE.md`
3. Read `.planning/ROADMAP.md`
4. Read active PRD from `.planning/prds/` (if referenced in STATE.md)

### END (Mandatory -- work is not done without these)
1. `.planning/STATE.md` -- replace (don't append), <80 lines
2. `.planning/ROADMAP.md` -- check off completed milestones
3. `tasks/lessons.md` -- add/refine lessons (max 10, promote to Learned Rules when full)
4. Commit doc updates to the feature branch

## Execution Rules
- **Plan before building.** Read the PRD before touching code.
- **Delegate immediately.** 3+ files or 3+ steps -> spawn agent team.
- **Verify everything.** Run `npx tsc --noEmit` after changes land.
- **All changes via PR.** Never commit directly to main.
- **Branch naming:** `feat/short-description` or `fix/short-description`

## Critical Rules
- forge-cc has NO dependency on Flow -- must work standalone
- No assumptions -- ask if requirements are genuinely unclear
- Leave code better than you found it

## Learned Rules
- **[agent staging]** Restage all files at wave boundaries -- parallel agents can disrupt each other's git index
- **[old file cleanup]** Delete old files immediately after migration to prevent type conflicts from stale code
- **[wave consolidation]** When a Wave 1 agent covers a Wave 2 task's scope, mark Wave 2 task complete -- don't spawn redundant agents
- **[cross-agent types]** Inline actual code from created files into downstream agent prompts -- never use predicted types
- **[between-wave verify]** Run `tsc --noEmit` between every wave, not just at the end
