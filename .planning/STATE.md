# forge-cc — Project State

## Current Position
- **Project:** Forge Concurrency Model
- **Milestone:** Not started (PRD approved)
- **Branch:** feat/forge-concurrency (not yet created)
- **Active PRD:** `.planning/prds/forge-concurrency.md`
- **Last Session:** 2026-02-15

## Milestone Progress
| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Worktree Manager + Session Registry | Pending |
| 2 | Skill Integration | Pending |
| 3 | Status Command + Cleanup UX | Pending |

## Key Decisions
- Git worktrees for automatic session isolation (not branch-based, not file-locking)
- Worktrees for /forge:go AND /forge:spec
- Hidden sibling directory: `../.forge-worktrees/<repo>/<session-id>/`
- Separate PRs always — no shared branches
- Per-session STATE.md, merged on completion
- Identity from git config user.name/email
- Per-branch verify cache (replaces single last-verify.json)
- No Linear project for this work — local PRD only
- M1 Wave 0 enforces spec system rules (AskUserQuestion, milestone sizing) before building concurrency

## Next Actions
1. Create branch `feat/forge-concurrency`
2. Run `/forge:go` to execute Milestone 1
