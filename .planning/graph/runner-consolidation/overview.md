# Forge Runner Loop Consolidation

## Problem
The Linear lifecycle in forge-cc has never worked end-to-end. Agents skip Linear sync instructions during build because they're bookkeeping alongside the primary task (writing code). This has been attempted 8-9 times targeting skill instructions — every attempt failed. The pre-commit hook is the only enforcement mechanism that works, because it's infrastructure the agent can't bypass.

## Solution
Use Claude Code hooks to handle the Linear lifecycle invisibly. Hooks fire automatically on tool events — the agent can't skip them. Branch naming enforcement via WorktreeCreate and PreToolUse hooks enables Linear's native GitHub integration to handle issue state transitions (In Review on PR open, Completed on PR merge) for free. PostToolUse hooks handle project status transitions. Plan creates milestones and assigns issues. Capture uses Backlog.

## Goals
1. Linear lifecycle works end-to-end without agent cooperation (hooks handle sync invisibly)
2. Branch naming enforced at infrastructure level (WorktreeCreate + PreToolUse hooks)
3. Linear's native GitHub integration handles issue transitions (PR open → In Review, PR merge → Completed)
4. Plan creates milestones per group and assigns issues to milestones
5. Build skill uses `computeWaves()` for parallel agent team execution

## Users
Developers using forge-cc skills with Linear integration and Codex auto-review enabled.

## Out of Scope
- Adversarial review enforcement via hooks (works well enough via skill instructions)
- TeammateIdle verification gates (verification already enforced by pre-commit hook)
- Stop hook reconciliation (can add later if gaps emerge)
- Ralph loop / auto-execute mode enhancements (future project)
- Changes to fix or quick skills (can add hook frontmatter later)

## Tech Stack
- TypeScript (ES2022, strict), Node.js
- Claude Code hooks (PreToolUse, PostToolUse, WorktreeCreate)
- Linear SDK (`@linear/sdk`)
- Existing forge-cc graph engine, Linear client, sync functions

## Key Research Findings
- WorktreeCreate hook fires on `isolation: "worktree"` and REPLACES default git behavior. Hook must create the worktree and print the path to stdout.
- PreToolUse `updatedInput` can rewrite Bash command parameters before execution.
- PostToolUse receives both `tool_input` and `tool_response` — can extract PR URLs.
- Hooks can be defined in skill frontmatter (scoped to skill lifecycle).
- Linear project status is NEVER automatic — must be managed via API.
- Linear milestones have no status field — progress auto-calculates from child issues.
- Linear's GitHub integration auto-links branches containing issue identifiers (e.g., FRG-132).
- PR automations configured: PR open → In Review, PR merge → Completed.
- Magic words in commits are OFF but branch-based linking works independently.

## Sacred Files
- `package-lock.json`, `dist/`, `.env`
- Existing test assertions must not break
- `hooks/pre-commit-verify.js` must not be modified
- Existing sync functions in `src/linear/sync.ts` should be reused, not rewritten

## Dual-Track Constraint
All changes must be additive. Existing skills, hooks, and CLI commands continue to work unchanged until the final PR is merged. New hooks are installed alongside existing ones.
