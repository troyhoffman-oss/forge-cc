# PRD: Agent Team Execution & Multi-PRD Queue

## Problem & Goals

forge-cc has two fundamental architectural problems:

**1. Fire-and-forget agents:** The execution engine uses isolated Sonnet subagents spawned via the Task tool. No communication, no review, no subagent delegation. Verification is purely mechanical (tsc, lint, tests). This misses logic errors, PRD misalignment, and architectural drift.

**2. Broken state management:** STATE.md and ROADMAP.md are single-file, single-writer state trackers that cannot scale:
- STATE.md tracks ONE active PRD — blocks multi-PRD workflows
- ROADMAP.md is a flat markdown file that `readRoadmapProgress()` parses with regex into a cross-project milestone soup (all projects' milestones mixed together)
- `/forge:spec` writes PRDs but never updates STATE.md or ROADMAP.md — new PRDs are invisible to `/forge:go` and `npx forge run`
- No feature branch creation in the spec→go handoff
- Two developers cannot run different PRDs simultaneously

**Desired outcome:**
1. Replace STATE.md/ROADMAP.md with per-PRD JSON status files that scale to multi-developer, multi-PRD workflows
2. Upgrade execution to real Opus agent teams (TeamCreate/SendMessage) with persistent reviewer, consensus protocol, and Codex post-PR review gate
3. Close the spec→go handoff gap so new PRDs are immediately executable

**Success criteria:**
- [ ] STATE.md and ROADMAP.md are eliminated — all references replaced
- [ ] Per-PRD status files at `.planning/status/<slug>.json` track milestone completion
- [ ] `/forge:spec` creates the status file + feature branch when writing a PRD
- [ ] `/forge:go` discovers PRDs by scanning `.planning/status/`, presents picker, offers manual/auto mode
- [ ] `npx forge run` supports `--prd <slug>` and `--all` flags for multi-PRD execution
- [ ] `/forge:go` creates real agent teams (TeamCreate) with executive, builders, reviewer
- [ ] Builders communicate via SendMessage, can spawn Sonnet subagents
- [ ] Reviewer engages builders in consensus-based review (builders can disagree)
- [ ] Post-PR Codex review gate polls every 60s for 8 minutes, resolves all comments
- [ ] Multiple PRDs execute in parallel worktrees with PRD-aware session registry

## User Stories

### US-1: State migration — per-PRD status tracking
**As a** developer on a multi-person team
**I want** each PRD to have its own status file instead of shared STATE.md/ROADMAP.md
**So that** multiple developers can work on different PRDs without state conflicts

**Acceptance criteria:**
- [ ] New module `src/state/prd-status.ts` reads/writes `.planning/status/<slug>.json`
- [ ] Status file schema: `{ project, branch, milestones: { "1": { status, date? } } }`
- [ ] `readPRDStatus(slug)` replaces `readRoadmapProgress()` — returns typed JSON, not regex-parsed markdown
- [ ] `updateMilestoneStatus(slug, milestoneNumber, status)` replaces `updateMilestoneProgress()`
- [ ] `discoverPRDs()` scans `.planning/status/` for all status files, returns list with pending counts
- [ ] `findNextPendingMilestone(slug)` scoped to a specific PRD's status file
- [ ] `countPendingMilestones(slug?)` — per-PRD or all PRDs
- [ ] All references to `readStateFile()`, `readRoadmapProgress()`, `writeStateFile()`, `updateRoadmapMilestone()` are replaced
- [ ] STATE.md and ROADMAP.md files deleted from `.planning/`
- [ ] CLAUDE.md session protocol updated to reference new status system
- [ ] `buildFreshSessionPrompt()` reads CLAUDE.md + PRD milestone section (no STATE.md)
- [ ] `auto-chain.ts` uses `readPRDStatus(slug)` instead of `findNextPendingMilestone()`
- [ ] `cli.ts` run command uses `countPendingMilestones(slug)` scoped to specific PRD

### US-2: Spec→Go handoff
**As a** developer running `/forge:spec` then `/forge:go`
**I want** `/forge:spec` to create the status file and feature branch automatically
**So that** new PRDs are immediately visible to `/forge:go` and `npx forge run`

**Acceptance criteria:**
- [ ] `/forge:spec` Step 4 (Generate PRD): also creates `.planning/status/<slug>.json` with all milestones "pending"
- [ ] `/forge:spec` Step 4: also creates feature branch `feat/<slug>` and records it in status file
- [ ] `/forge:go` Step 1: scans `.planning/status/` instead of reading STATE.md
- [ ] `npx forge run`: scans `.planning/status/` for PRDs with pending milestones
- [ ] Zero manual state file editing required between spec and go

### US-3: Developer executes milestone with agent team
**As a** developer running `/forge:go`
**I want** a real agent team (executive + builders + reviewer) that communicates via SendMessage
**So that** builders can coordinate, review findings get discussed, and subagents handle grunt work

**Acceptance criteria:**
- [ ] TeamCreate creates team with executive, N builders, 1 reviewer, optional notetaker
- [ ] Builders run on Opus with `mode: "bypassPermissions"`
- [ ] Builders can spawn Sonnet subagents (Explore for research, general-purpose for implementation)
- [ ] Reviewer examines diff after each wave, sends findings via SendMessage to builders
- [ ] Builders can disagree with reviewer findings — consensus protocol (max 2 rounds, then executive decides)
- [ ] No hard cap on builder count — executive decides based on milestone wave structure
- [ ] Notetaker spawned when 3+ waves or 4+ agents (per wave-execution skill pattern)

### US-4: Post-wave review with consensus
**As a** developer
**I want** the reviewer agent to engage builders in actual discussion about findings
**So that** review is a dialogue, not a rubber stamp — builders can push back on incorrect findings

**Acceptance criteria:**
- [ ] Reviewer reads diff against PRD + CLAUDE.md + architecture decisions
- [ ] Reviewer sends structured findings via SendMessage to relevant builder(s)
- [ ] Builder can accept, dispute, or propose alternative — sends response via SendMessage
- [ ] If consensus reached in ≤2 rounds, finding is resolved
- [ ] If deadlocked after 2 rounds, executive makes final call
- [ ] Mechanical gates (tsc, lint, tests) still run before reviewer — reviewer focuses on logic/PRD/architecture

### US-5: Post-PR Codex review gate
**As a** developer
**I want** the system to wait for Codex review comments after PR creation and resolve them
**So that** an independent external LLM provides a final quality check

**Acceptance criteria:**
- [ ] After PR is opened via `gh pr create`, system polls for review comments every 60 seconds
- [ ] Polling continues for 8 minutes (8 checks)
- [ ] If comments found, a fix agent resolves each comment (code fix or justified reply)
- [ ] After fixes pushed, polls for one more cycle (new comments from re-review)
- [ ] Milestone marked complete only when PR has zero unresolved comments
- [ ] If no Codex comments after 8 minutes, proceed (Codex may not be configured)

### US-6: PRD selector and mode routing
**As a** developer running `/forge:go`
**I want** to select which PRD to execute and choose manual vs auto mode
**So that** I have one consistent entry point for all execution

**Acceptance criteria:**
- [ ] `/forge:go` scans `.planning/status/*.json` for PRDs with pending milestones
- [ ] User selects a PRD (auto-selects if only one)
- [ ] User chooses: "Manual (interactive)" or "Auto (ralph loop)"
- [ ] Manual → continues in-session with agent team execution
- [ ] Auto → prints exact `npx forge run --prd <slug>` command for new terminal
- [ ] Status indicators show pending/in-progress/complete milestone counts per PRD

### US-7: Multi-PRD queue for npx forge run
**As a** developer on a multi-person team
**I want** `npx forge run` to handle multiple PRDs with parallel worktrees
**So that** Matt and I can run different PRDs simultaneously without conflicts

**Acceptance criteria:**
- [ ] `npx forge run` (no args) → interactive CLI picker for PRD selection
- [ ] `npx forge run --prd <slug>` → runs specific PRD's milestones
- [ ] `npx forge run --all` → runs all PRDs, parallel worktrees for independent ones
- [ ] Session registry tracks which PRD each session is executing
- [ ] Two developers running different PRDs get isolated worktrees and branches
- [ ] PRD status shown in `npx forge status` (pending/executing/complete per PRD)

## Technical Approach

### State Architecture (New)

**Kill STATE.md and ROADMAP.md. Replace with per-PRD status JSON.**

```
.planning/
  prds/
    forge-agent-teams.md          ← the spec (immutable after creation)
    email-report-polish.md
  status/
    forge-agent-teams.json        ← milestone completion status
    email-report-polish.json
```

**Status file schema:**
```json
{
  "project": "Agent Team Execution & Multi-PRD Queue",
  "slug": "forge-agent-teams",
  "branch": "feat/agent-teams",
  "createdAt": "2026-02-16",
  "milestones": {
    "1": { "status": "complete", "date": "2026-02-16" },
    "2": { "status": "in_progress" },
    "3": { "status": "pending" }
  }
}
```

**What replaces what:**

| Old | New |
|-----|-----|
| STATE.md `**Active PRD:**` | `discoverPRDs()` — scan `.planning/status/` |
| STATE.md `**Milestone:**` | Status JSON `milestones.N.status` |
| STATE.md `**Branch:**` | Status JSON `branch` field |
| ROADMAP.md milestone tables | Status JSON per PRD (no cross-project pollution) |
| `readStateFile()` | `readPRDStatus(slug)` |
| `readRoadmapProgress()` | `readPRDStatus(slug)` — typed JSON, no regex |
| `writeStateFile()` | `updateMilestoneStatus(slug, N, status)` |
| `updateRoadmapMilestone()` | `updateMilestoneStatus(slug, N, status)` |
| `findNextPendingMilestone()` | `findNextPendingMilestone(slug)` — scoped to one PRD |
| `countPendingMilestones()` | `countPendingMilestones(slug?)` — per-PRD or all |
| `buildFreshSessionPrompt()` reads STATE.md | Reads CLAUDE.md + PRD milestone section only |

**All code references that must be updated:**
- `src/state/reader.ts` — `readStateFile()`, `readRoadmapProgress()`, `readSessionContext()`
- `src/state/writer.ts` — `writeStateFile()`, `updateRoadmapMilestone()`, `updateMilestoneProgress()`
- `src/go/auto-chain.ts` — `buildFreshSessionPrompt()`, `findNextPendingMilestone()`, `countPendingMilestones()`, `completeMilestone()`
- `src/go/executor.ts` — `buildMilestoneContext()` calls `readSessionContext()`
- `src/cli.ts` — run command uses `countPendingMilestones()`
- `skills/forge-go.md` — Step 1 reads STATE.md/ROADMAP.md, Step 6 updates them
- `skills/forge-spec.md` — Step 6 handoff (add status file + branch creation)
- `CLAUDE.md` — Session Protocol references both files

### Agent Team Architecture (3-Tier)

```
Executive (orchestrator — /forge:go skill or npx forge run)
├── TeamCreate: "{milestone}-team"
├── Builder Agent 1 (Opus, SendMessage, spawns subagents)
│   ├── Research Subagent (Sonnet Explore)
│   └── Implementation Subagent (Sonnet general-purpose)
├── Builder Agent 2 (Opus, SendMessage, spawns subagents)
├── ...Builder Agent N
├── Reviewer Agent (Opus, persistent team member, SendMessage)
└── Notetaker Agent (Opus, optional — 3+ waves or 4+ agents)
```

### Wave Execution Flow

```
Wave N:
  executive spawns builder agents via Task(team_name, run_in_background)
  builders work, communicate via SendMessage ←→ executive
  builders spawn subagents as needed
  builders complete, report done via SendMessage

Post-Wave:
  1. Restage all files (learned: parallel agents disrupt git index)
  2. Mechanical gates: tsc --noEmit, biome lint, npm test
  3. Reviewer examines diff via SendMessage
  4. Builders respond to findings (consensus protocol, max 2 rounds)
  5. Fix agent addresses agreed findings
  6. Re-run mechanical gates
  7. If clean → next wave. If not → fix loop (max 3 iterations)

Post-Milestone (after all waves):
  1. Commit milestone work
  2. Update status JSON: milestone → "complete"
  3. Open PR via gh pr create
  4. Codex review gate: poll every 60s for 8 minutes
  5. Resolve any Codex comments (fix or reply)
  6. Milestone complete only when PR has 0 unresolved comments
  7. Shutdown all agents, TeamDelete
```

### Consensus Protocol

```
reviewer sends finding to builder via SendMessage:
  { finding: "...", severity: "error|warning", file: "...", line: N }

builder responds:
  - "agree" → finding queued for fix agent
  - "disagree: <reason>" → reviewer re-evaluates
  - "alternative: <proposal>" → reviewer evaluates proposal

round 2 (if disagreement):
  reviewer either accepts builder's reasoning or escalates

escalation (deadlock):
  executive reviews both positions, makes final call
```

### Workflow Loop (New — End to End)

```
/forge:triage → brain dump → Linear projects (Backlog)
                              Linear project list IS the roadmap

/forge:spec   → lists Backlog projects from Linear
              → user selects one
              → interview → generates PRD
              → writes .planning/prds/<slug>.md
              → writes .planning/status/<slug>.json (all milestones "pending")
              → creates feature branch (git checkout -b feat/<slug>)
              → syncs milestones to Linear → project "Planned"

/forge:go     → scans .planning/status/*.json for pending milestones
              → if multiple PRDs: presents picker
              → if one PRD: auto-selects
              → user chooses: Manual / Auto
                → Manual: executes in-session with agent teams
                → Auto: prints "npx forge run --prd <slug>"

npx forge run → --prd <slug>: runs that PRD's milestones
              → --all: parallel worktrees for all pending PRDs
              → no args: interactive picker
              → per milestone: fresh claude session → updates status JSON → loops
```

## Scope

### In Scope
- Replace STATE.md/ROADMAP.md with per-PRD JSON status files
- Update all code references (reader, writer, auto-chain, executor, CLI, skills)
- Close spec→go handoff gap (status file + branch creation in /forge:spec)
- TeamCreate/SendMessage agent team execution in /forge:go
- Persistent reviewer agent with consensus protocol
- Builder subagent spawning (Opus builders → Sonnet subagents)
- Notetaker agent (conditional on wave/agent count)
- Codex post-PR review gate (poll 60s × 8 minutes)
- PRD selector UX in /forge:go (scan status/, select PRD, select mode)
- Multi-PRD queue for npx forge run (--prd, --all)
- PRD-aware session registry
- Parallel worktrees per PRD
- Update /forge:spec skill to create status file + feature branch
- Update /forge:go skill for new state system + agent teams
- Update CLAUDE.md session protocol

### Out of Scope
- Changes to /forge:triage skill (it creates Linear projects, unaffected)
- Changes to /forge:setup (scaffolding templates may need minor update later)
- New verification gates (existing gates remain)
- Linear integration changes (issue/milestone sync stays as-is)
- Changes to the wave-execution standalone skill
- Cross-PRD milestone dependencies (PRDs are independent units for now)

### Sacred Files
- `src/gates/types-gate.ts`, `lint-gate.ts`, `tests-gate.ts` — mechanical gates unchanged
- `src/spec/scanner.ts`, `interview.ts`, `generator.ts` — spec engine internals untouched
- `src/linear/` — Linear client untouched
- `src/config/schema.ts` — config schema unchanged (new fields additive only)

## Lessons Learned (Carry Forward)

These lessons from prior milestones MUST be followed during execution:

- **[agent staging]** Restage all files at wave boundaries — parallel agents can disrupt each other's git index
- **[old file cleanup]** Delete old files immediately after migration to prevent type conflicts from stale code being compiled
- **[cross-agent types]** Inline actual code from created files into downstream agent prompts — never use predicted/spec types that may differ from what was actually built
- **[between-wave verify]** Run `tsc --noEmit` between every wave, not just at the end — catches cross-agent integration issues before spawning the next wave's agents
- **[test-behavior-sync]** When edge-case agents change function behavior, update existing tests in the same wave to match
- **[wave consolidation]** When Wave 1 covers Wave 2 scope, skip redundant agents — don't spawn agents for already-done work
- **[no compaction chaining]** Never rely on context compaction for multi-milestone auto mode. Fresh processes with file system as memory between iterations.

## Milestones

### Milestone 1: State Migration to Per-PRD Status JSON
**Goal:** Replace STATE.md and ROADMAP.md with per-PRD JSON status files. Update all code references so the execution loop works with the new system. This is the foundation — everything else depends on it.

**Wave 1 — New Status Module + Reader Refactor (2 agents parallel):**
1. **status-module-agent**: Creates `src/state/prd-status.ts` with full status file lifecycle: `PRDStatusSchema` (Zod), `readPRDStatus(slug)`, `writePRDStatus(slug, status)`, `updateMilestoneStatus(slug, number, status)`, `discoverPRDs()` (scans `.planning/status/`), `findNextPendingMilestone(slug)`, `countPendingMilestones(slug?)`. Creates `.planning/status/` directory. Writes status JSON for the current PRD (`forge-agent-teams.json`) with milestones from this PRD.
   - Files: `src/state/prd-status.ts`, `.planning/status/forge-agent-teams.json`

2. **reader-refactor-agent**: Refactors `src/state/reader.ts` to remove `readStateFile()` and `readRoadmapProgress()`. Replaces `readSessionContext()` to use `readPRDStatus(slug)` from the new status module. Updates function signatures to accept `prdSlug` instead of relying on STATE.md. Keeps `readCurrentMilestone()` unchanged (reads from PRD file, not state).
   - Files: `src/state/reader.ts`

**Wave 2 — Writer Refactor + Auto-Chain/Executor Update (2 agents parallel):**
1. **writer-refactor-agent**: Refactors `src/state/writer.ts` to remove `writeStateFile()` and `updateRoadmapMilestone()`. Replaces `updateMilestoneProgress()` to call `updateMilestoneStatus()` from the new status module. Updates `commitMilestoneWork()` to stage status JSON instead of STATE.md/ROADMAP.md. Removes `writeSessionMemory()` (session state now in status JSON).
   - Files: `src/state/writer.ts`

2. **chain-executor-agent**: Updates `src/go/auto-chain.ts`: `buildFreshSessionPrompt()` reads CLAUDE.md + PRD milestone section only (no STATE.md). `findNextPendingMilestone()` delegates to `prd-status.ts` with slug. `countPendingMilestones()` delegates with slug. `completeMilestone()` calls `updateMilestoneStatus()`. `runAutoChain()` accepts `prdSlug` parameter. Updates `src/go/executor.ts`: `buildMilestoneContext()` uses new `readSessionContext()` that accepts slug.
   - Files: `src/go/auto-chain.ts`, `src/go/executor.ts`

**Wave 3 — CLI + Skills + Cleanup (2 agents parallel):**
1. **cli-skills-agent**: Updates `src/cli.ts` run command to accept `--prd <slug>` flag and use `countPendingMilestones(slug)`. Updates `src/cli.ts` status command to show per-PRD status from status files. Updates `skills/forge-go.md` Step 1 to scan `.planning/status/` instead of reading STATE.md/ROADMAP.md. Updates `skills/forge-go.md` Step 6 to update status JSON instead of STATE.md/ROADMAP.md. Updates `skills/forge-spec.md` Step 4 to create `.planning/status/<slug>.json` and feature branch. Updates `CLAUDE.md` session protocol to reference status files.
   - Files: `src/cli.ts`, `skills/forge-go.md`, `skills/forge-spec.md`, `CLAUDE.md`

2. **test-cleanup-agent**: Writes tests for `prd-status.ts` (read, write, discover, find pending, count pending). Updates existing tests that reference STATE.md/ROADMAP.md. Deletes `.planning/STATE.md` and `.planning/ROADMAP.md`. Verifies no remaining imports of removed functions.
   - Files: `src/state/__tests__/prd-status.test.ts`, `.planning/STATE.md` (delete), `.planning/ROADMAP.md` (delete)

**Verification:** `npx tsc --noEmit && npm test`
**Acceptance:** US-1 (per-PRD status tracking), US-2 (spec→go handoff)

---

### Milestone 2: Agent Team Infrastructure
**dependsOn:** 1
**Goal:** Build the team lifecycle, reviewer, consensus protocol, and Codex gate modules. These are the building blocks for the /forge:go skill upgrade.

**Wave 1 — Core Types & Team Lifecycle (2 agents parallel):**
1. **types-agent**: Creates `src/team/types.ts` with AgentRole, TeamConfig, Finding, ConsensusRound, ConsensusResult, ReviewResult, CodexComment types. All types use Zod schemas for validation. Updates `src/types.ts` with team-related re-exports.
   - Files: `src/team/types.ts`, `src/types.ts`

2. **lifecycle-agent**: Creates `src/team/lifecycle.ts` with createMilestoneTeam(), shutdownTeam(), sendToAgent(), broadcastToTeam() helpers that wrap TeamCreate/SendMessage. Creates `src/team/index.ts` barrel export.
   - Files: `src/team/lifecycle.ts`, `src/team/index.ts`

**Wave 2 — Reviewer & Consensus (2 agents parallel):**
1. **reviewer-agent**: Creates `src/team/reviewer.ts` with reviewWaveDiff() that analyzes git diff against PRD criteria, CLAUDE.md rules, and architecture. Returns structured Finding[] with severity, file, line, message. Reuses diff parsing logic from existing `src/gates/review-gate.ts`.
   - Files: `src/team/reviewer.ts`

2. **consensus-agent**: Creates `src/team/consensus.ts` with runConsensusProtocol() that manages the find→respond→resolve/escalate flow. Tracks rounds per finding, handles agree/disagree/alternative responses, escalates to executive after 2 rounds of deadlock.
   - Files: `src/team/consensus.ts`

**Wave 3 — Codex Gate & Tests (2 agents parallel):**
1. **codex-gate-agent**: Creates `src/gates/codex-gate.ts` with pollForCodexComments() (uses `gh api repos/{owner}/{repo}/pulls/{pr}/comments`, 60s interval, 8 checks), resolveCodexComment() (spawns fix agent or posts justified reply), and runCodexGate() that orchestrates the full poll-resolve cycle.
   - Files: `src/gates/codex-gate.ts`

2. **test-agent**: Writes tests for team lifecycle, reviewer, consensus, and codex gate modules. Uses vitest. Mocks TeamCreate/SendMessage calls and `gh` CLI invocations.
   - Files: `src/team/__tests__/lifecycle.test.ts`, `src/team/__tests__/reviewer.test.ts`, `src/team/__tests__/consensus.test.ts`, `src/gates/__tests__/codex-gate.test.ts`

**Verification:** `npx tsc --noEmit && npm test`
**Acceptance:** US-3 (team infrastructure), US-4 (consensus protocol), US-5 (codex gate)

---

### Milestone 3: /forge:go Skill Upgrade + Multi-PRD Queue
**dependsOn:** 1, 2
**Goal:** Rewrite /forge:go to use real agent teams with PRD selector and manual/auto mode. Upgrade npx forge run for multi-PRD execution with parallel worktrees.

**Wave 1 — PRD Selector + Executor Refactor (2 agents parallel):**
1. **prd-selector-agent**: Creates `src/go/prd-selector.ts` with discoverPendingPRDs() (wraps `discoverPRDs()` from prd-status, filters to pending), presentPRDPicker() (formats for AskUserQuestion), presentModePicker() (manual/auto). Handles single-PRD auto-select.
   - Files: `src/go/prd-selector.ts`

2. **executor-refactor-agent**: Refactors `src/go/executor.ts` to use team lifecycle from M2. Updates `buildAgentPrompt()` to include SendMessage instructions, subagent spawning guidance, and team context. Updates `parseMilestoneSection()` to support flexible builder counts. Integrates with `readPRDStatus()` for status tracking.
   - Files: `src/go/executor.ts`

**Wave 2 — Verify Loop + Finalize + Multi-PRD Queue (3 agents parallel):**
1. **verify-loop-agent**: Updates `src/go/verify-loop.ts` to integrate the reviewer agent into post-wave verification. After mechanical gates pass, invokes reviewer via SendMessage, runs consensus protocol from M2, spawns fix agents for agreed findings.
   - Files: `src/go/verify-loop.ts`

2. **finalize-agent**: Updates `src/go/finalize.ts` to run the Codex review gate after PR creation. Adds pollAndResolve() step between PR open and milestone completion. Milestone only marks complete in status JSON when 0 unresolved PR comments.
   - Files: `src/go/finalize.ts`

3. **prd-queue-agent**: Creates `src/go/prd-queue.ts` with PRDQueue class: scanPRDs() uses discoverPRDs() from prd-status, getReadyPRDs() returns PRDs with pending milestones not currently executing, dispatchPRD() creates worktree and starts execution. Updates `src/worktree/session.ts` to add prdSlug field. Updates `src/go/auto-chain.ts` for multi-PRD support. Updates `src/cli.ts` to add `--prd` and `--all` flags to run command and per-PRD status display.
   - Files: `src/go/prd-queue.ts`, `src/worktree/session.ts`, `src/go/auto-chain.ts`, `src/cli.ts`

**Wave 3 — Skill Rewrite + Tests (2 agents parallel):**
1. **skill-agent**: Rewrites `skills/forge-go.md` end-to-end: Step 1 scans status files and presents PRD picker + mode selector. Step 3 uses TeamCreate-based wave execution with SendMessage, reviewer consensus, subagent spawning. Step 5 commits + updates status JSON. Step 6 updates status JSON. Step 8 routes based on mode choice. Adds Codex gate to PR flow. References wave-execution skill patterns (3-tier hierarchy, conflict avoidance, notetaker decision).
   - Files: `skills/forge-go.md`

2. **test-agent**: Writes tests for PRD selector, PRD queue, session registry prdSlug field, CLI --prd/--all flags, and auto-chain multi-PRD flow. Integration test: two PRDs dispatched in parallel get separate worktrees and sessions.
   - Files: `src/go/__tests__/prd-selector.test.ts`, `src/go/__tests__/prd-queue.test.ts`, `src/go/__tests__/auto-chain.test.ts`

**Verification:** `npx tsc --noEmit && npm test`
**Acceptance:** US-3 (agent teams), US-4 (consensus), US-5 (codex gate), US-6 (PRD selector + mode), US-7 (multi-PRD queue)
