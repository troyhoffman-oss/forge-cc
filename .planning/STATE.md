# forge-cc — Project State

## Current Position
- **Version:** 0.1.4 (published)
- **Project:** Forge Concurrency Model
- **Milestone:** Not started (PRD approved)
- **Branch:** feat/forge-concurrency
- **Active PRD:** `.planning/prds/forge-concurrency.md`
- **Last Session:** 2026-02-15

## Recently Shipped (v0.1.4)
- `/forge:setup` skill (7-step project scaffolding)
- `/forge:update` skill (version check + npm update)
- `hooks/version-check.js` (PreToolUse session hook)
- `src/setup/templates.ts` (scaffold templates)
- Slimmed CLAUDE.md, ROADMAP.md startup docs

## Milestone Progress
| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Worktree Manager + Session Registry | Pending |
| 2 | Skill Integration | Pending |
| 3 | Status Command + Cleanup UX | Pending |

## Key Decisions
- Git worktrees for automatic session isolation (not branch-based, not file-locking)
- Worktrees for /forge:go AND /forge:spec
- Hidden sibling directory: `../.forge-wt/<repo>/<8-char-id>/` (short paths for Windows)
- Separate PRs always — no shared branches
- Per-session STATE.md, merged on completion
- Identity from git config user.name/email
- Per-branch verify cache (replaces single last-verify.json)
- Windows-safe platform utils (atomic writes with retry, path normalization)
- Parallel milestone execution via `dependsOn` field + DAG scheduler
- No Linear project for this work — local PRD only
- M1 Wave 0 enforces spec system rules (AskUserQuestion, milestone sizing)

## Next Actions
1. Run `/forge:go` to execute Milestone 1
