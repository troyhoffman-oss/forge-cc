# forge-cc — Roadmap

## Projects
| Project | Status | Milestones |
|---------|--------|------------|
| forge-mcp (research) | Complete (2026-02-15) | 3 milestones |
| forge-cc (build) | Complete (2026-02-15) | 5 milestones |

---

## forge-cc (Build Phase)
**Goal:** Build the unified dev workflow tool (forge-cc) that replaces Flow plugin + forge-mcp prototype. Single npm package with CLI verification, workflow skills, Linear lifecycle management, and mechanical enforcement.

**PRD:** `.planning/prds/forge-build.md`
**Branch:** `feat/forge-build`

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Core CLI + Verification Engine — gates, CLI, hooks, MCP, tests | Complete (2026-02-15) |
| 2 | Linear Integration + Triage Skill — Linear lifecycle, /forge:triage | Complete (2026-02-15) |
| 3 | Spec Skill — /forge:spec interview, PRD generation, Linear sync | Complete (2026-02-15) |
| 4 | Execution Engine — /forge:go manual + auto mode, context resets, PR creation | Complete (2026-02-15) |
| 5 | Integration, Testing + Documentation — E2E, README, npm publish readiness | Complete (2026-02-15) |

---

## forge-mcp (Research Phase) — COMPLETE
**Goal:** Design the optimal e2e autonomous dev workflow for Troy + Matt using Claude Code, Flow, Linear, and verification tooling. Produce RECOMMENDATION.md as input for the build PRD.

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Parallel Deep Research — 5 agents (flow audit, OAI patterns, Linear lifecycle, verification, msig patterns) | Complete (2026-02-15) |
| 2 | Cross-Cutting Analysis — 3 agents (architecture options, multi-dev gaps, ideal state vision) | Complete (2026-02-15) |
| 3 | Synthesis — 1 agent produces RECOMMENDATION.md | Complete (2026-02-15) |
