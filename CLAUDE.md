# forge-mcp — Claude Code Instructions

## Quick Context
Standalone MCP server that handles pre-PR verification as structured tools. Agents call forge-mcp tools to validate their work before opening a PR. Companion to Flow — Flow orchestrates *when* to verify, forge-mcp executes *how*.

**Tech Stack:** TypeScript, Node.js (ES2022), `@modelcontextprotocol/sdk`, Playwright, Zod
**Key Doc:** `ANALYSIS.md` — full research analysis and architectural direction

### Existing Code
- `src/types.ts` — GateResult, VisualResult, PipelineInput, PipelineResult
- `src/tools/verify-types.ts` — tsc --noEmit gate
- `src/tools/verify-lint.ts` — biome check gate
- `src/tools/verify-tests.ts` — npm run test gate
- `src/tools/verify-visual.ts` — Playwright screenshot + console error gate
- `src/tools/verify-runtime.ts` — API endpoint validation gate
- `src/tools/verify-prd.ts` — diff vs PRD acceptance criteria gate
- `src/tools/run-pipeline.ts` — orchestrates all gates with iteration loop
- `src/utils/browser.ts` — Playwright browser lifecycle
- `src/utils/reporter.ts` — structured report generation

### START (Every Session)
1. Read CLAUDE.md
2. Read `.planning/STATE.md`
3. Read `.planning/ROADMAP.md`
4. Read active PRD from `.planning/prds/` (if exists)

## Execution Rules
- **Plan before building.** Read the PRD in `.planning/prds/` before touching anything.
- **Delegate immediately.** 3+ files → spawn agent team within first 2 tool calls.
- **Verify everything.** Run `npx tsc --noEmit` after work lands.

## Git Workflow
- All changes via PR. Never commit directly to main.
- Branch naming: `fix/short-description` or `feat/short-description`

## Session-End Docs (MANDATORY)
1. `.planning/STATE.md` — replace (don't append), <80 lines
2. `.planning/ROADMAP.md` — update milestone progress
3. `tasks/lessons.md` — add/refine lessons
4. Commit doc updates to feature branch

## Critical Rules
- No assumptions — ask if requirements unclear
- Fight entropy — leave code better than you found it
- forge-mcp has NO dependency on Flow — must work standalone
