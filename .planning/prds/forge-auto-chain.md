# forge-cc — Auto-Chain: `npx forge run`

**Project:** Forge Auto-Chain
**Status:** In Progress
**Branch:** feat/forge-auto-chain
**Created:** 2026-02-15
**Assigned To:** Troy

## Overview

Close the last gap in forge's autonomous execution pipeline. When `/forge:go --auto` is selected, instead of printing "start a new session", direct the user to `npx forge run` — a Node.js CLI command that implements the Ralph Wiggum Loop pattern: a loop spawning fresh `claude -p` processes with `stdio: 'inherit'`, one per milestone, with the file system as the only memory between iterations.

## Problem Statement

Auto mode today is a misnomer. When you select "Auto (all milestones)" in `/forge:go`, it:

1. Executes the current milestone (waves, agents, verify, commit, state update)
2. Prints: "To continue autonomously, start a new session and run: `/forge:go --auto`"
3. **Stops.** The user must manually start a new session.

The solution is a new CLI entry point `npx forge run` that spawns fresh `claude -p` processes per milestone with inline terminal output.

## Architecture

```
User terminal:  npx forge run
                    |
                    v
        ┌──────────────────────┐
        │  Node.js loop (cli.ts)│
        │                      │
        │  for each milestone:  │
        │    spawnSync claude -p │──> "Invoke /forge:go --single"
        │    check exit code    │        │
        │    check ROADMAP.md   │        v
        │    stall detection    │    Full /forge:go pipeline
        │                      │    (waves, agents, verify,
        │  pending == 0? done  │     commit, state update)
        └──────────────────────┘
```

**Why this works:**
- Fresh process per milestone (new `claude -p` = new context window)
- Inline output (`stdio: 'inherit'` — output goes straight to user's terminal)
- Simple UX (one command: `npx forge run`)
- Tiny implementation (~40 lines in cli.ts + small helper)

**The prompt to each Claude session:**
```
You are executing one milestone of a forge auto-chain.
Use the Skill tool: skill="forge:go", args="--single"
After the skill completes, stop.
```

No need for `buildFreshSessionPrompt()` — the skill reads CLAUDE.md, STATE.md, ROADMAP.md itself in Step 1.

## User Stories

### US-1: True Autonomous Execution
**As** a developer, **I want** to run `npx forge run` and have all milestones chain automatically across fresh Claude sessions, **so that** I can start the process and walk away.

**Acceptance Criteria:**
- [ ] `npx forge run` spawns fresh `claude -p` processes, one per milestone
- [ ] Each session gets a genuinely fresh context window (new process)
- [ ] All existing verification, testing, and state management runs within each session
- [ ] The chain stops on: all milestones complete, milestone failure, stall, or max iterations
- [ ] Output streams inline to the user's terminal (`stdio: 'inherit'`)

### US-2: Safe Failure Handling
**As** a developer, **I want** the auto-chain to stop cleanly on failure, **so that** I can debug and resume.

**Acceptance Criteria:**
- [ ] Non-zero exit code from `claude` stops the chain
- [ ] Stall detection: if pending count doesn't decrease, chain stops
- [ ] Max iterations cap prevents infinite loops (default: 20)
- [ ] Resuming is simple: fix the issue, run `npx forge run` again

### US-3: Discoverable UX
**As** a developer, **I want** to learn about `npx forge run` naturally through the workflow, **so that** I don't need to read docs.

**Acceptance Criteria:**
- [ ] `/forge:spec` output mentions `npx forge run` after PRD creation
- [ ] `/forge:go` Auto mode directs users to exit and run `npx forge run`
- [ ] `/forge:go` Step 8 mentions `npx forge run` as an option after milestone completion
- [ ] `npx forge run --help` is self-documenting
- [ ] CLAUDE.md Quick Reference table includes `npx forge run`

## Technical Approach

### `src/go/auto-chain.ts` — Add `countPendingMilestones()`

```typescript
export async function countPendingMilestones(projectDir: string): Promise<number> {
  const roadmap = await readRoadmapProgress(projectDir);
  if (!roadmap) return 0;
  return roadmap.milestones.filter(m =>
    !m.status.toLowerCase().startsWith("complete") &&
    !m.status.toLowerCase().startsWith("done")
  ).length;
}
```

### `src/cli.ts` — Add `forge run` command (~40 lines)

- Pre-flight: check `countPendingMilestones > 0`, check ROADMAP.md exists
- Print banner: what's about to happen, how many milestones, how to stop (Ctrl+C)
- Loop: `spawnSync("claude", ["-p", PROMPT, "--dangerously-skip-permissions"], { stdio: "inherit", cwd: projectDir })`
- Stop conditions: exit code !== 0, stall (pending count didn't decrease), max iterations, all complete

### `skills/forge-go.md` — Three changes

1. Step 1 Part B: Add `--single` flag handling
2. Auto Mode section: Replace with instructions to exit and use `npx forge run`
3. Step 8: Mention `npx forge run` as an option

### `skills/forge-spec.md` — Add `npx forge run` to post-creation output

## Scope

### In Scope
- `countPendingMilestones()` in auto-chain.ts
- `forge run` CLI command in cli.ts
- Updated skill files (forge-go.md, forge-spec.md)
- CLAUDE.md Quick Reference update
- Tests for countPendingMilestones and findNextPendingMilestone

### Out of Scope
- Parallel milestone execution (separate feature)
- Log file rotation
- GUI/TUI monitoring
- Changes to Steps 1-7 of /forge:go pipeline

### Sacred / Do NOT Touch
- Steps 1-7 of `/forge:go` — the milestone execution pipeline is unchanged
- `src/go/executor.ts`, `verify-loop.ts`, `finalize.ts` — no changes
- `src/state/reader.ts`, `writer.ts` — no changes
- All verification gates — no changes
- Linear sync — no changes

## Milestones

### Milestone 1: npx forge run

**Goal:** Add `npx forge run` CLI command and update skills to reference it.

**Wave 1 (3 agents parallel):**

| Agent | Task | Files |
|-------|------|-------|
| auto-chain-helpers | Add `countPendingMilestones()` to auto-chain.ts. Create tests for both `countPendingMilestones` and `findNextPendingMilestone`. | `src/go/auto-chain.ts`, `tests/go/auto-chain.test.ts` |
| skill-update | Update forge-go.md with `--single` flag, auto mode redirect, Step 8 update. Update forge-spec.md with `npx forge run` mention. | `skills/forge-go.md`, `skills/forge-spec.md` |
| cli-run-command | Add `forge run` command to cli.ts with spawnSync loop, stall detection, max iterations. | `src/cli.ts` |

**Verification:**
- `npx tsc --noEmit` passes
- `npm test` passes
- Skills mention `npx forge run` correctly
