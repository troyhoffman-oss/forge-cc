# forge-cc — Concurrency & Session Isolation

**Project:** Forge Concurrency Model
**Status:** Draft
**Branch:** feat/forge-concurrency
**Created:** 2026-02-15
**Assigned To:** Troy

## Overview

Add automatic git worktree-based session isolation to forge-cc so that multiple terminal sessions on one machine and multiple users on the same repo can run `/forge:go` and `/forge:spec` simultaneously without corrupting each other's work. Sessions are fully isolated by default — no manual worktree management, no remembering which branch to be on, no state file collisions.

## Problem Statement

forge-cc currently assumes a single-orchestrator model. Every write path — STATE.md, ROADMAP.md, verify cache, git staging — is a bare `writeFile` with no coordination. This worked during initial development but breaks in real usage:

1. **Flow already proved this fails.** Flow tried branch-based isolation but constantly landed on the wrong branch, overwrote state docs, and corrupted session continuity. The branch approach without proper isolation was "a mess."
2. **Git index is shared.** Two sessions staging files in the same working directory corrupt each other's commits. The learned rule "restage all files at wave boundaries" only works within a single session.
3. **STATE.md is last-write-wins.** Session A completes milestone 3, writes STATE.md. Session B (still on M3) completes and overwrites back. Progress tracking is lost.
4. **ROADMAP.md has read-modify-write races.** `updateRoadmapMilestone()` reads the file, regex-replaces, writes back. Two concurrent updates lose one.
5. **Verify cache can lie.** Session A fails verification, Session B passes. Pre-commit hook reads Session B's cache and allows Session A's broken commit.
6. **Matt onboarding.** A second developer means two people running forge commands on the same repo. This must work on day one.

## User Stories

### US-1: Multi-Terminal Isolation
**As** Troy, **I want to** run `/forge:go` on project A in one terminal while running `/forge:spec` on project B in another terminal, **so that** neither session sees or corrupts the other's work.

**Acceptance Criteria:**
- [ ] Each `/forge:go` and `/forge:spec` invocation automatically creates a git worktree
- [ ] Worktrees are created in a hidden sibling directory (e.g., `../.forge-worktrees/<repo>/<session-id>/`)
- [ ] The user never manually creates, enters, or cleans up worktrees
- [ ] Sessions on different projects are fully independent (different repos = no conflict)
- [ ] Sessions on the same project get separate worktrees with separate git indexes

### US-2: Multi-User Same Repo
**As** Troy and Matt working on the same repo, **I want** both of us to run `/forge:go` on different milestones simultaneously, **so that** our work is isolated and produces separate PRs.

**Acceptance Criteria:**
- [ ] Each user's session is identified by git config user.name/email
- [ ] Each session produces its own branch and PR
- [ ] STATE.md and ROADMAP.md are per-session during execution, merged on completion
- [ ] Session registry (`.forge/sessions.json`) tracks all active sessions
- [ ] No file locking bottlenecks — isolation via worktrees, not mutexes

### US-3: Session Visibility
**As** a developer, **I want** `npx forge status` to show all active sessions across the repo, **so that** I know who's working on what before starting my own work.

**Acceptance Criteria:**
- [ ] `npx forge status` shows: session ID, user (from git config), milestone/skill, start time, worktree path
- [ ] Stale sessions (worktree exists but process dead) are flagged and can be cleaned up
- [ ] Status works from the main repo directory (reads session registry, not just local state)

### US-4: Automatic Cleanup
**As** a developer, **I want** worktrees to be cleaned up automatically when a session completes, **so that** disk space doesn't accumulate and I never think about worktree lifecycle.

**Acceptance Criteria:**
- [ ] On successful completion: state merged back, worktree deleted, session deregistered
- [ ] On error/crash: worktree preserved for debugging, session marked as "stale" in registry
- [ ] `npx forge cleanup` manually removes stale sessions and their worktrees
- [ ] Cleanup is idempotent — running it twice doesn't error

## Technical Approach

### Architecture

```
src/
  worktree/
    manager.ts        # Create, list, delete worktrees (wraps git worktree commands)
    session.ts        # Session registry (read/write .forge/sessions.json)
    state-merge.ts    # Merge per-session STATE.md/ROADMAP.md back to main
    identity.ts       # Get user identity from git config
```

### Worktree Lifecycle

1. **Create:** `/forge:go` or `/forge:spec` starts → `WorktreeManager.create()` → new worktree at `../.forge-worktrees/<repo>/<session-id>/` on a new branch `forge/<user>/<milestone-or-spec-slug>`
2. **Register:** Session entry written to `.forge/sessions.json` in the main repo (atomic write via temp+rename)
3. **Execute:** All work happens inside the worktree directory. The skill's working directory is the worktree, not the main repo.
4. **Merge state:** On completion, `StateMerger.merge()` reads the worktree's STATE.md/ROADMAP.md updates and applies them to the main repo's copies intelligently (not last-write-wins)
5. **Finalize:** PR created from worktree branch. Worktree deleted. Session deregistered.
6. **Crash recovery:** If process dies, session stays in registry as "stale." `npx forge cleanup` or next session start cleans up.

### Session Registry (`.forge/sessions.json`)

```typescript
interface SessionRegistry {
  sessions: Array<{
    id: string;               // UUID
    user: string;             // git config user.name
    email: string;            // git config user.email
    skill: "go" | "spec";    // Which skill is running
    milestone?: string;       // Milestone name (for /forge:go)
    branch: string;           // Worktree branch name
    worktreePath: string;     // Absolute path to worktree
    startedAt: string;        // ISO timestamp
    pid: number;              // Process ID for stale detection
    status: "active" | "stale" | "completing";
  }>;
}
```

Writes to the registry use atomic temp-file-then-rename to prevent corruption from concurrent access.

### State Merge Strategy

When a session completes, its STATE.md changes must merge back:
- **STATE.md:** The completing session's state is authoritative for its milestone. Merge by updating the milestone section, preserving other sessions' sections.
- **ROADMAP.md:** Mark the completed milestone as done. Use structured parsing (not regex) to avoid read-modify-write races.
- **Conflict:** If two sessions somehow completed the same milestone (shouldn't happen with separate milestones), last completer wins with a warning.

### Verify Cache

Change `.forge/last-verify.json` to `.forge/verify-cache/<branch-name>.json`. Each branch gets its own cache. Pre-commit hook reads the cache matching the current branch.

### Identity

```typescript
// identity.ts
function getCurrentUser(): { name: string; email: string } {
  const name = execSync("git config user.name").toString().trim();
  const email = execSync("git config user.email").toString().trim();
  return { name, email };
}
```

### Dependencies

- No new npm dependencies. Git worktree commands are available in git 2.5+ (2015). `child_process.execSync` for git commands.
- Atomic file writes use `fs.writeFileSync` to a temp file + `fs.renameSync` (POSIX atomic rename).

## Scope

### In Scope
- Worktree manager (create, list, delete, cleanup)
- Session registry with atomic writes
- Identity from git config
- `/forge:go` integration — runs in worktree, merges state on completion
- `/forge:spec` integration — runs in worktree for PRD writes
- `npx forge status` showing all active sessions
- Per-branch verify cache
- Automatic cleanup on success, manual cleanup command for crashes
- State merge logic for STATE.md and ROADMAP.md

### Out of Scope
- Distributed/remote concurrency (cross-machine locking, CI coordination)
- Automatic merge conflict resolution between PRs
- Real-time session-to-session communication
- Shared dev server port management (each worktree would need its own port — future)

### Sacred / Do NOT Touch
- Existing gate implementations (`src/gates/*`) — they run in whatever directory they're given
- Linear integration (`src/linear/*`) — API calls are stateless, no changes needed
- CLI command structure (`src/cli.ts`) — add to it, don't restructure

## Milestones

### Milestone 1: Worktree Manager + Session Registry

**Goal:** Build the foundation — enforce spec system rules, then create/delete worktrees, track sessions, identify users. Everything else depends on this.

**Wave 0 — Enforce spec system rules (2 agents):**
| Agent | Task | Files |
|-------|------|-------|
| interview-rules | Rewrite forge-spec.md interview instructions (Step 3) to REQUIRE AskUserQuestion tool with multiple-choice options for every interview question. Remove all text-based numbered question patterns. Add explicit rule: "NEVER present questions as numbered text — always use AskUserQuestion with 2-4 options per question." Update interview.ts JSDoc to document that question objects are rendered via AskUserQuestion, not printed as text. | `skills/forge-spec.md`, `src/spec/interview.ts` |
| milestone-sizing | Add milestone sizing constraint as a hard rule. In templates.ts: add `maxContextWindowFit` field to MilestoneSchema (boolean, default true) and add JSDoc stating milestones MUST fit in one agent context window. In forge-spec.md: add rule to Step 3 milestones section and Step 4 generation — "Each milestone MUST be completable in one main agent context window. If a milestone requires more than ~4 agents across 2-3 waves, split it." In forge-go.md: add pre-flight warning in Step 2 if milestone has >3 waves or >6 agents. | `src/spec/templates.ts`, `skills/forge-spec.md`, `skills/forge-go.md` |

**Wave 1 — Core modules (2 agents):**
| Agent | Task | Files |
|-------|------|-------|
| worktree-manager | Git worktree create/list/delete, path conventions, error handling | `src/worktree/manager.ts` |
| session-registry | Session CRUD with atomic writes, stale detection, identity helper | `src/worktree/session.ts`, `src/worktree/identity.ts` |

**Wave 2 — State merge + tests (2 agents):**
| Agent | Task | Files |
|-------|------|-------|
| state-merger | Merge per-session STATE.md/ROADMAP.md back to main repo | `src/worktree/state-merge.ts` |
| tests | Unit tests for all worktree modules (mock git commands) | `tests/worktree/manager.test.ts`, `tests/worktree/session.test.ts`, `tests/worktree/state-merge.test.ts` |

**Verification:**
- `npx tsc --noEmit` passes
- `npm test` passes — worktree manager creates/deletes worktrees correctly
- Session registry handles concurrent writes without corruption
- State merge preserves both sessions' data
- forge-spec.md contains zero text-based question patterns — all questions use AskUserQuestion
- forge-go.md warns on oversized milestones in pre-flight

---

### Milestone 2: Skill Integration

**Goal:** Wire worktree isolation into `/forge:go` and `/forge:spec` so they automatically run in worktrees. Also update verify cache to per-branch.

**Wave 1 — Skill wiring (2 agents):**
| Agent | Task | Files |
|-------|------|-------|
| go-integration | Update executor, verify-loop, finalize, and auto-chain to use worktree manager. Ensure all paths run inside worktree directory. | `src/go/executor.ts`, `src/go/verify-loop.ts`, `src/go/finalize.ts`, `src/go/auto-chain.ts` |
| spec-integration | Update spec workflow to create worktree for PRD writes. Ensure scanner, interview, generator use worktree as cwd. | `src/spec/scanner.ts`, `src/spec/generator.ts`, `src/spec/linear-sync.ts` |

**Wave 2 — Verify cache + skill docs (2 agents):**
| Agent | Task | Files |
|-------|------|-------|
| verify-cache | Change cache from single file to per-branch directory. Update CLI, pre-commit hook, and status command. | `src/cli.ts`, `src/hooks/pre-commit.ts`, `hooks/pre-commit-verify.js`, `src/types.ts` |
| skill-docs | Update forge-go.md and forge-spec.md skill instructions to reflect worktree workflow | `skills/forge-go.md`, `skills/forge-spec.md` |

**Verification:**
- `npx tsc --noEmit` passes
- `/forge:go` creates a worktree, executes inside it, merges state back, cleans up
- `/forge:spec` creates a worktree for PRD generation
- Verify cache is per-branch — two branches have independent caches
- Pre-commit hook reads correct branch's cache

---

### Milestone 3: Status Command + Cleanup UX

**Goal:** Make sessions visible and stale sessions recoverable. Polish the developer experience.

**Wave 1 — Status + cleanup (2 agents):**
| Agent | Task | Files |
|-------|------|-------|
| status-command | Enhance `npx forge status` to show all active sessions (user, milestone, duration, worktree path). Flag stale sessions. | `src/cli.ts`, `src/reporter/human.ts` |
| cleanup-command | Add `npx forge cleanup` command — remove stale worktrees, deregister dead sessions, reclaim disk space | `src/cli.ts`, `src/worktree/manager.ts` |

**Wave 2 — Integration tests + docs (2 agents):**
| Agent | Task | Files |
|-------|------|-------|
| e2e-tests | Integration tests: two simulated sessions on same repo, verify isolation, state merge, cleanup | `tests/e2e/concurrency.test.ts` |
| docs | Update README.md with concurrency section, update CLAUDE.md code map | `README.md`, `CLAUDE.md` |

**Verification:**
- `npx forge status` shows active sessions with user, milestone, and timing
- `npx forge cleanup` removes stale worktrees and deregisters dead sessions
- E2E test proves two sessions don't corrupt each other
- All gates pass: `npx forge verify`

## Dogfooding Directive

This is forge-cc's first end-to-end project run on its own codebase. Treat every session as a live test of the entire forge workflow. This is not optional — it's the primary meta-deliverable alongside the concurrency features.

**What to observe and record:**
- Every point of friction with `/forge:spec`, `/forge:go`, `/forge:triage`
- Every moment where the skill instructions are ambiguous, wrong, or produce bad output
- Every place where the PRD format doesn't match what `/forge:go` expects to parse
- Every gap between what the interview captured and what execution actually needed
- Wave sizing — did milestones actually fit in one context window? Were agents scoped correctly?
- State management — did STATE.md/ROADMAP.md updates work cleanly between sessions?
- Lessons system — did `tasks/lessons.md` get updated with real issues? Did the cap/promotion system work?

**Where to record findings:**
- `tasks/lessons.md` — one-liner per issue (existing system, max 10, promote when full)
- `.planning/prds/forge-dogfood-findings.md` — detailed findings doc. Create after M1 completes. No length cap. Include: what broke, what was clunky, what worked well, proposed fixes. This becomes the backlog for the next forge improvement cycle.

**Standard:** If a session completes without adding at least one lesson or finding, something was missed. Forge is new — there WILL be friction. Find it and write it down.

## Verification

### Per-Milestone
- `npx tsc --noEmit` passes after every wave
- `npm test` passes after every wave
- No regressions in existing gate tests
- At least one dogfooding finding captured per milestone

### Overall
- Two simultaneous `/forge:go` sessions on different milestones produce separate, clean PRs
- `npx forge status` shows both sessions during execution
- STATE.md and ROADMAP.md reflect both sessions' work after completion
- Stale session cleanup works (kill a session, run cleanup, verify worktree removed)
- Zero new npm dependencies added
- `.planning/prds/forge-dogfood-findings.md` exists with actionable findings

