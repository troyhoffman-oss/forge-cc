# Codex PR Review Polling

## Problem
After forge skills create a PR, Codex auto-reviews are posted asynchronously. The agent session moves on and reviews go unaddressed. This feature existed in earlier forge versions but was lost during the v2 rewrite.

## Goals
1. After any skill creates a PR, automatically poll for Codex review comments (60s intervals, 8 minutes max)
2. When a review is found, the agent evaluates each comment using its own judgment, pushes fixes for valid feedback, and replies/resolves on GitHub
3. After resolving all comments, return control to the user for merge approval
4. The agent must NEVER auto-merge

## Users
Developers using forge-cc skills (build, quick, fix) who have Codex auto-review enabled on their repos.

## Out of Scope
- No webhook/server infrastructure — polling from agent session only
- No auto-merge — always return to user
- No new CLI commands — use existing `forge codex-poll`
- No new gates — this is a skill-layer feature

## Tech Stack
- TypeScript (ES2022, strict), Node.js
- Skills are markdown instruction files interpreted by Claude Code
- `src/codex-poll.ts` provides the polling + detection infrastructure
- `gh api` used by the agent for GitHub comment replies

## Conventions
- Skill reference docs go in `skills/ref/`
- Skills reference shared protocols via "Follow the X Protocol in ref/X.md"
- `codex-poll.ts` exports pure functions; CLI wiring is in `cli.ts`

## Sacred Files
- `package-lock.json`, `dist/`, `.env`
- Existing test assertions in `tests/codex-poll.test.ts` must not break
