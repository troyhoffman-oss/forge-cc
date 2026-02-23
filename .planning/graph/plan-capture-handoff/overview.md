# Plan-Capture Handoff

## Problem Statement
`/forge:plan` currently defaults to asking "what are you building?" from scratch, duplicating the work `/forge:capture` already did. The capture → plan pipeline is broken because plan doesn't know how to find or load captured projects.

## Goals
1. Make `/forge:plan` default to listing captured Linear projects so the user picks one to expand
2. Load full capture context (project description, issues, labels) into the planning interview
3. Archive original capture issues after plan creates the proper requirement graph

## Users
Developers using the forge-cc workflow pipeline (capture → plan → build).

## Scope
- **In scope:** Plan skill default flow, Linear client methods, capture issue lifecycle
- **Out of scope:** Capture skill changes, graph format changes, build skill changes

## Decisions
- **No standalone mode flag.** If no captured projects exist, fall back to standalone interview. Otherwise, always show the project picker.
- **Archive and replace.** Original capture issues are archived when plan creates requirement graph issues. No linking.
- **Full context loading.** Plan loads project name, description, AND all captured issues to use as draft requirements.

## Tech Stack
- TypeScript (ES2022, strict), Node.js
- @linear/sdk for Linear API
- Skills are markdown files executed by Claude Code

## Sacred Files
- `_index.yaml` graph format — no schema changes
- `src/graph/` — no changes to graph engine
- `.forge.json` — no config changes
- `skills/forge-capture.md` — no changes to capture skill
