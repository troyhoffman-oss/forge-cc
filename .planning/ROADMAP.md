# forge-cc — Roadmap

## Projects
| Project | Status | Milestones |
|---------|--------|------------|
| forge-mcp (research) | Complete | 3 |
| forge-cc (build) | Complete | 5 |
| setup/update skills | Complete (v0.1.4) | — |
| forge-concurrency | Complete | 3 |
| forge-harness-upgrade | Complete | 4 |

---

## Forge Concurrency Model
**Goal:** Add automatic git worktree-based session isolation so multiple terminals and multiple users can run forge commands simultaneously without corruption.

**PRD:** `.planning/prds/forge-concurrency.md`
**Branch:** `feat/forge-concurrency`

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Worktree Manager + Session Registry (includes Wave 0: spec system rules) | Complete (2026-02-15) |
| 2 | Skill Integration + Parallel Milestones — wire worktrees, parallel scheduler, per-branch cache | Complete (2026-02-15) |
| 3 | Status Command + Cleanup UX — npx forge status, npx forge cleanup, e2e tests | Complete (2026-02-15) |

---

## Forge Harness Engineering Upgrade
**Goal:** Add enhanced visual gate (before/after, multi-viewport, DOM extraction), code review gate, and gate remediation templates.

**PRD:** `.planning/prds/forge-harness-upgrade.md`
**Branch:** `feat/forge-harness`

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Multi-Viewport Visual Capture + DOM Extraction | Complete (2026-02-15) |
| 2 | Before/After Comparison + Visual Reviewer | Complete (2026-02-15) |
| 3 | Code Review Gate | Complete (2026-02-15) |
| 4 | Gate Remediation Templates | Complete (2026-02-15) |
