# forge-cc — Roadmap

## Projects
| Project | Status | Milestones |
|---------|--------|------------|
| forge-mcp (research) | Complete | 3 |
| forge-cc (build) | Complete | 5 |
| setup/update skills | Complete (v0.1.4) | — |
| forge-concurrency | In Progress | 3 |

---

## Forge Concurrency Model
**Goal:** Add automatic git worktree-based session isolation so multiple terminals and multiple users can run forge commands simultaneously without corruption.

**PRD:** `.planning/prds/forge-concurrency.md`
**Branch:** `feat/forge-concurrency`

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Worktree Manager + Session Registry (includes Wave 0: spec system rules) | Pending |
| 2 | Skill Integration + Parallel Milestones — wire worktrees, parallel scheduler, per-branch cache | Pending |
| 3 | Status Command + Cleanup UX — npx forge status, npx forge cleanup, e2e tests | Pending |
