# forge-mcp — Research Analysis

This document is the research input for `/flow:spec`. It captures the full analysis
from the OpenAI "Harness Engineering" comparison, gap identification, and architectural
direction. The spec session should reference this for context.

## Source

OpenAI "Harness engineering: leveraging Codex in an agent-first world" (Feb 11 2026)
by Ryan Lopopolo. Full analysis was produced in a prior session.

## What forge-mcp Is

A standalone MCP server that handles pre-PR verification as structured tools.
Agents call forge-mcp tools to validate their work before opening a PR.

**Separation of concerns:**
- **Flow** = orchestration (when to verify, what waves to run)
- **forge-mcp** = execution (how to verify, the actual gates)
- Flow's `go.md` calls forge-mcp tools at the right moments
- forge-mcp has no dependency on Flow (can be used standalone)

## Proposed Tools

| Tool | What It Does |
|------|-------------|
| `forge_types` | Runs `tsc --noEmit`, returns pass/fail + error list |
| `forge_lint` | Runs `biome check`, returns pass/fail + violations |
| `forge_tests` | Runs `npm run test`, returns pass/fail + test results |
| `forge_visual` | Boots dev server, screenshots pages, captures console errors |
| `forge_runtime` | Hits API endpoints, validates response shapes + status codes |
| `forge_prd` | Reads git diff, compares against PRD acceptance criteria |
| `run_pipeline` | Orchestrates all gates, loops until clean (max N iterations), returns full report |

## Target Verification Pipeline

```
Agent writes code
    |
GATE 1: tsc --noEmit (type safety)              <- HAVE THIS
    |
GATE 2: biome check (lint/format)               <- HAVE THIS
    |
GATE 3: npm run test (unit tests)               <- HAVE THIS
    |
GATE 4: Visual Validation Loop                   <- BUILD
    Boot dev server -> screenshot key pages
    -> check for console errors -> compare
    before/after -> if broken: FIX + RESTART
    -> LOOP UNTIL CLEAN
    |
GATE 5: Runtime Validation                       <- BUILD
    Check: no unhandled errors in console,
    API routes return 200, data renders correctly
    |
GATE 6: Self-review (agent reviews own diff)     <- BUILD
    Agent reads its own PR diff, checks against
    PRD acceptance criteria, catches things the
    linters miss
    |
PR opened
    |
GATE 7: Codex automated review                  <- HAVE THIS (via /flow:done)
```

## Architecture Direction

- MCP server using `@modelcontextprotocol/sdk`
- Playwright for browser automation (visual + runtime gates)
- Structured JSON returns (no text parsing)
- Persistent browser session between checks
- `run_pipeline` as the core orchestration tool

## Open Design Questions (for spec session)

1. Which gates are MVP vs. later phases?
2. Dev server lifecycle — who owns the process? Port conflicts?
3. How does run_pipeline integrate with Flow's go.md?
4. Is PRD heuristic matching useful or noise?
5. Should visual gate require Playwright install or use existing @playwright/mcp?
6. Screenshot comparison (before/after) — how to baseline?
7. Max iterations and escalation behavior
8. Report format and where it gets persisted (PR body? PRD? separate file?)

## Existing Scaffolding

A preliminary project structure exists at `C:\Users\TroyHoffman\forge-mcp\` with:
- package.json, tsconfig.json, types.ts (foundation)
- Tool implementations (draft quality — written before spec, may need revision)
- Dependencies installed (MCP SDK, Playwright, Zod)

The spec session should evaluate whether to build on this scaffolding or restructure.

## Related: Playwright MCP Activation

Separate from forge-mcp, activating `@playwright/mcp` in Claude Code settings gives
agents ad-hoc browser access. This is independent of forge-mcp and can be done anytime.

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```
