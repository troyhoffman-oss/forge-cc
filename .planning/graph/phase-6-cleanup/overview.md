# Phase 6 Cleanup — Project Overview

## Problem
forge-cc still has dual milestone+graph execution paths, dead milestone code, a Linear bug where `resolveIssueStateByCategory` throws when states have no category, and a missing `codex-poll` CLI command referenced by the `forge:build` skill.

The codebase is ~4K lines in src/ and should be leaner after removing the old milestone path.

## Goals
1. **Single execution path (graph only)** — delete all milestone/PRD runner code, types, status handling, and CLI flags
2. **Fix Linear state resolution** — add name-based fallback to `resolveIssueStateByCategory` for all states
3. **Implement codex-poll** — `npx forge codex-poll --owner --repo --pr` polls GitHub PR for Codex review comments
4. **Net src/ line count decrease** from pre-graph baseline (~3,981 lines currently)

## Users
Troy Hoffman — sole user of forge-cc.

## Tech Stack
- TypeScript (ES2022, strict), Node.js, Commander, Zod, Vitest
- `@linear/sdk` for Linear API
- Graph module in `src/graph/` (sacred — do not modify)

## Sacred Files
- `src/graph/*` — graph engine, do not modify
- `skills/*` — already rewritten, do not modify
- `skills/ref/*` — reference docs, do not modify
- `package-lock.json`, `dist/`, `.env`

## Out of Scope
- New workflow features (context monitoring, pause/resume, model profiles)
- Gate system changes
- Worktree manager changes
- Refactoring working code unrelated to milestone removal

## Conventions
- All exports are named (no default exports)
- Functions use async/await, not callbacks
- Linear sync is best-effort (warn, don't crash)
- Tests use Vitest with temp directories for isolation
