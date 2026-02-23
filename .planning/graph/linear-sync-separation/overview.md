# Linear Sync Separation

## Problem

Forge's `syncGraphProjectDone` batch-moves all issues to "Done" the moment the graph completes, before the PR is even reviewed. This preempts Linear's GitHub automation ("PR open -> In Review", "PR merge -> Completed") and skips the review state entirely. Additionally, Forge never links issues to branches/PRs, so Linear's GitHub automation can't fire even if we stop preempting it.

## Solution

Split ownership at the PR boundary:

- **Forge owns planning-to-execution:** Issue Planned -> In Progress, Project Backlog -> Planned -> In Progress -> In Review
- **Linear/GitHub owns PR-to-merge:** Issue In Progress -> In Review (on PR open), Issue In Review -> Completed (on PR merge)

## Goals

1. Stop preempting Linear's GitHub automation — remove issue batch-to-Done transition
2. Enable Linear's GitHub automation — link issues to branches so Linear can match PRs to issues
3. Add missing project lifecycle transitions — Planned (after planning) and In Review (after graph completion)

## Out of Scope

- forge:capture / forge:triage Linear changes
- Project -> Done transition (removed entirely — no automated path to Done; happens manually or via future hook)
- Milestone-level Linear sync
- UI or dashboard changes
- Adding a `linearStates` config field to .forge.json schema

## Tech Stack & Conventions

- TypeScript (ES2022, strict), Node.js, Commander, Zod, Vitest
- `@linear/sdk` for all Linear API calls via `ForgeLinearClient` wrapper
- Category-based state resolution with name hints for disambiguation
- All Linear sync is best-effort — warn on failure, never block execution
- Tests use Vitest with `vi.mock()` for the Linear SDK

## Sacred Files

- `package-lock.json` — do not modify manually
- `dist/` — generated, do not edit
- `.forge.json` — user config, schema changes need Zod schema update

## Key Integration Points

- `src/linear/sync.ts` — sync functions called from runner and CLI
- `src/linear/client.ts` — ForgeLinearClient wraps @linear/sdk
- `src/runner/loop.ts` — graph execution loop, calls sync functions
- `src/cli.ts` — CLI commands under `forge linear` subcommand group
- `skills/forge-build.md` — skill instructions reference Linear state transitions
- `skills/forge-plan.md` — skill instructions for planning phase, will call new CLI command
