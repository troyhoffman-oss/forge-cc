# PRD: Forge v2 — Full Rewrite

## Problem & Goals

### Problem
forge-cc v1 accumulated layers of patches, redundant code paths, and architectural debt that make it unreliable and confusing. A comprehensive audit (Feb 2026) identified:

- Linear integration split across 3 disconnected code paths with silent failures and no team scoping
- 200+ lines of duplicated diff parsing logic
- Install/setup flow confusion (postinstall skill copy, separate setup skill, version-check hook hitting npm on every Task call)
- MCP server as a thin gate wrapper with hardcoded version
- Dead code paths and stale module references in skill files
- No concept of target Linear team — projects land in the wrong workspace

Most critically: the auto-execution mode (`forge run`) has never worked reliably. Agents skip Linear sync, write novelty tests, and lose work across concurrent terminals.

### Goals
1. **Reliable execution loop** — Ralph loop (per Geoffrey Huntley) that runs milestones to completion with deterministic verification
2. **Deterministic Linear sync** — agents never touch Linear; forge CLI handles all state transitions as side effects
3. **No lost work** — worktree-per-milestone isolation prevents concurrent terminals from stomping each other
4. **Clean, minimal codebase** — fewer modules, single code path per concern, no dead code
5. **Extensible verification** — pluggable gate system that starts with types/lint/tests and can grow
6. **Team-scoped from birth** — Linear team selection is first-class config, not an afterthought

### Success Criteria
- `forge run` executes a multi-milestone PRD to completion unattended (Ralph loop)
- Linear project state transitions happen automatically at each milestone boundary
- Two terminals running different milestones never conflict (worktree isolation)
- Codebase is under 2,000 lines of TypeScript (v1 is ~5,000+)
- Three core gates (types, lint, tests) pass reliably on every run

### Inspiration
- [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/) — repository as system of record, Ralph Wiggum Loop, layered architecture, mechanical enforcement, agent legibility
- [Ryan Carson's Code Factory](https://x.com/rikicarson) — risk-aware verification, preflight gates, SHA-pinned evidence, remediation loops
- [Geoffrey Huntley's Ralph](https://ghuntley.com/ralph/) — dead-simple bash loop execution (`claude -p "prompt" --dangerously-skip-permissions`)

### Design Philosophy
- **Thinner skills, deterministic CLI commands.** Critical paths (Linear sync, verification, status updates) are CLI commands that can't be skipped. Skills focus on conversation and coordination — what LLMs are good at.
- **No novelty tests.** Agents implement features; they do NOT write tests to pass gates. Tests are PRD-specified or pre-existing. Forge verifies, it doesn't test-generate.
- **Milestone as the unit of execution.** Forge is project-size agnostic. Whether a project has 3 milestones or 20, the execution model is the same.
- **3-layer verification:** (1) Mechanical gates (types/lint/tests) → (2) Self-healing fix loop → (3) Pluggable review (future). Layer 1 and 2 ship in v2. Layer 3 is a designed extension point.

## User Stories

### US-1: Triage Ideas into Linear Projects
**As** a developer with scattered ideas,
**I want** to brain-dump into a triage session that organizes ideas into Linear projects,
**So that** my backlog is structured and ready for planning.

**Acceptance Criteria:**
- Run `/forge:triage` and paste unstructured notes
- Forge deduplicates against existing Linear projects (scoped to configured team)
- New projects created in Linear with "Backlog" state after user confirmation

### US-2: Spec a Project into a PRD
**As** a developer with a Linear project in Backlog,
**I want** an adaptive interview that produces a detailed PRD with milestones,
**So that** I have a clear execution plan synced to Linear.

**Acceptance Criteria:**
- Run `/forge:spec`, select a Backlog project from the configured Linear team
- Adaptive interview covers problem, users, technical approach, scope, milestones
- PRD written to `.planning/prds/<slug>.md`
- Milestones and issues created in Linear
- Linear project transitions to "Planned"
- All Linear IDs stored in `.planning/status/<slug>.json` (project ID, milestone IDs, issue IDs)
- Feature branch `feat/<slug>` created automatically

### US-3: Execute Milestones Interactively
**As** a developer working on a milestone,
**I want** to run `/forge:go` for interactive, human-in-the-loop execution with agent teams,
**So that** I can guide complex work with real-time feedback.

**Acceptance Criteria:**
- Run `/forge:go`, select a PRD and milestone
- Forge creates a worktree for the milestone (isolated from other work)
- Agent teams execute waves with `forge verify` between each wave
- Skill calls `forge linear-sync start` at beginning, `forge linear-sync complete` at end
- Worktree merges back to PRD branch on completion

### US-4: Execute Milestones Autonomously
**As** a developer who wants unattended execution,
**I want** `forge run` to loop through milestones using Ralph loops,
**So that** work progresses while I sleep or focus on other things.

**Acceptance Criteria:**
- `npx forge run --prd <slug>` starts the Ralph loop
- Each iteration: create worktree → build prompt → spawn `claude -p "..." --dangerously-skip-permissions` → verify → update status
- On verify pass: merge worktree, sync Linear, advance to next milestone
- On verify fail: loop again with error context in prompt
- Full visibility: stdout shows what Claude is doing in each iteration
- Exits cleanly when all milestones complete or max iterations reached

### US-5: Verify Code Quality
**As** a developer (human or agent),
**I want** `forge verify` to run all configured gates and report results,
**So that** I know if my code meets the project's quality bar.

**Acceptance Criteria:**
- `npx forge verify` runs types, lint, and tests gates
- `npx forge verify --json` outputs structured JSON (each gate: passed, errors[])
- Exit code 0 on all-pass, non-zero on any failure
- Results cached to `.forge/last-verify.json`
- Configurable gate timeouts via `.forge.json`

### US-6: Work Across Multiple Terminals
**As** a developer with multiple terminals open,
**I want** each forge session to work in its own worktree without conflicts,
**So that** I never lose work due to concurrent operations.

**Acceptance Criteria:**
- Each milestone gets its own worktree directory and branch
- Terminal 1 executing Project X M1 and Terminal 2 speccing Project Y work in separate directories
- Two terminals on different milestones of the same project don't conflict
- Worktrees merge cleanly back to the PRD branch on milestone completion
- Uncommitted work is never silently discarded

### US-7: Onboard a New Project
**As** a developer setting up forge on a new codebase,
**I want** `forge setup` to configure everything in one step,
**So that** I can start using forge immediately.

**Acceptance Criteria:**
- `npx forge setup` generates `.forge.json` with team selection (lists Linear teams, user picks one)
- Installs skill files to `~/.claude/commands/forge/`
- Installs pre-commit hook
- Adds forge-specific lines to CLAUDE.md
- Validates Linear connection (API key + team accessibility)
- `forge doctor` confirms environment is ready

## Technical Approach

### Architecture: Minimal Modules, Maximum Reliability

```
src/
  cli.ts              # CLI entry — forge verify, run, status, setup, linear-sync, doctor
  server.ts           # MCP server (forge_run_pipeline over stdio)
  types.ts            # Core types (GateResult, ForgeConfig, PRDStatus, VerifyCache)
  config/
    schema.ts          # Zod schema for .forge.json
    loader.ts          # Load + validate config, auto-detect fallbacks
  gates/
    index.ts           # Gate registry + runPipeline()
    types-gate.ts      # tsc --noEmit
    lint-gate.ts       # Biome linting
    tests-gate.ts      # Project test suite runner
  linear/
    client.ts          # @linear/sdk wrapper (team-scoped operations)
    sync.ts            # All Linear state transitions (one file, one code path)
  state/
    status.ts          # Read/write .planning/status/*.json (Zod-validated)
    cache.ts           # Verify cache (.forge/last-verify.json)
  runner/
    loop.ts            # Ralph loop: create worktree → build prompt → spawn claude → verify → merge
    prompt.ts          # Prompt builder (PRD milestone section + error context + rules)
  worktree/
    manager.ts         # Simple worktree create/merge/remove (3 functions, ~50 lines)
```

### Key Design Decisions

1. **Worktree isolation is simple.** Three functions: `createWorktree()`, `mergeWorktree()`, `removeWorktree()`. No session registry, no stale detection, no parallel scheduler. ~50 lines.

2. **No spec engine in TypeScript.** Scanner, interview, and generator are all LLM-driven via the `/forge:spec` skill. No TypeScript backing needed — the LLM reads the codebase and drives the interview.

3. **No team coordination in TypeScript.** Agent teams are orchestrated by skill files using Claude Code's built-in TeamCreate/SendMessage. Forge doesn't model teams.

4. **Linear sync is CLI-driven, not agent-driven.** When `forge run` completes a milestone, IT calls `linear/sync.ts`. The agent never touches Linear. For interactive `/forge:go`, the skill calls `forge linear-sync start|complete` CLI commands at transition points. This is non-negotiable — agents in v1 skipped Linear sync when they felt like it.

5. **All Linear IDs resolved at spec time.** The status file stores `linearProjectId`, `linearMilestoneId`, and `linearIssueIds[]` per milestone. No lookups at execution time. No ID resolution failures.

6. **Gates are pluggable.** The gate registry maps names to functions. Adding a gate = adding one file + registering it. Default: types, lint, tests. Future: visual, runtime, prd-review.

7. **Ralph loop is a thin shell.** `forge run` creates a worktree, builds a prompt, pipes it to `claude -p "..." --dangerously-skip-permissions`, checks verify results, and loops. ~100 lines.

8. **@linear/sdk over raw GraphQL.** Official SDK provides typed operations, built-in pagination, and error handling. One dependency, major reliability win.

9. **Configurable Linear state mapping.** `.forge.json` maps forge transitions to Linear state names. Default: `{ planned: "Planned", inProgress: "In Progress", inReview: "In Review", done: "Done" }`. Users with custom workflow states override in config.

10. **Thinner skills, deterministic CLI.** Skills are ~100-line orchestrators that call forge CLI commands for critical paths. Skills handle conversation and coordination (what LLMs excel at). CLI commands handle Linear sync, verification, and status updates (what must be deterministic).

### Stack
- **Language:** TypeScript (ES2022, strict, ESM)
- **Runtime:** Node.js >= 18
- **CLI:** Commander
- **Validation:** Zod
- **Linear:** @linear/sdk
- **MCP:** @modelcontextprotocol/sdk
- **Tests:** Vitest
- **Subprocess:** Claude CLI (`claude -p "..." --dangerously-skip-permissions`)

### Config: `.forge.json`
```json
{
  "gates": ["types", "lint", "tests"],
  "gateTimeouts": { "tests": 300000 },
  "maxIterations": 5,
  "linearTeam": "monument-square",
  "linearStates": {
    "planned": "Planned",
    "inProgress": "In Progress",
    "inReview": "In Review",
    "done": "Done"
  },
  "verifyFreshness": 600000,
  "forgeVersion": "1.0.0"
}
```

### State Files

**PRD Status** (`.planning/status/<slug>.json`):
```json
{
  "project": "Forge v2",
  "slug": "forge-v2-full-rewrite",
  "branch": "feat/forge-v2-full-rewrite",
  "createdAt": "2026-02-18",
  "linearProjectId": "uuid-from-linear",
  "milestones": {
    "1": {
      "status": "complete",
      "linearMilestoneId": "uuid",
      "linearIssueIds": ["uuid1", "uuid2"],
      "completedAt": "2026-02-19"
    },
    "2": {
      "status": "in_progress",
      "linearMilestoneId": "uuid",
      "linearIssueIds": ["uuid3", "uuid4"]
    },
    "3": { "status": "pending", "linearMilestoneId": "uuid", "linearIssueIds": [] }
  }
}
```

**Verify Cache** (`.forge/last-verify.json`):
```json
{
  "timestamp": "2026-02-18T15:30:00Z",
  "result": "PASSED",
  "gates": {
    "types": { "passed": true },
    "lint": { "passed": true },
    "tests": { "passed": true, "summary": "12 passed, 0 failed" }
  }
}
```

### Ralph Loop Prompt Template
```
# Task: Complete Milestone {N} — {Name}

## What to build
{PRD milestone section — pasted verbatim}

## Current state
{Last forge verify output, or "First iteration — start from scratch"}

## Rules
- Run `npx forge verify` before finishing. All gates must pass.
- Commit your work before exiting.
- Do NOT create tests just to make gates pass. Fix real issues only.
```

### Branching & Worktree Model
```
main (protected — no direct commits)
└── feat/project-x (PRD branch, created by /forge:spec)
    ├── feat/project-x/m1 (milestone 1 worktree, merges back when done)
    ├── feat/project-x/m2 (milestone 2 worktree, merges back when done)
    └── ... → PR to main when all milestones complete
```

Worktree directories: `../.forge-wt/<repo>/<milestone-slug>/`

## Scope

### In Scope
- CLI commands: `verify`, `run`, `status`, `setup`, `linear-sync`, `doctor`, `update`
- Gates: types, lint, tests (pluggable registry for future gates)
- Linear integration: @linear/sdk client, deterministic sync, team-scoped, configurable state mapping
- State management: PRD status files (with Linear IDs), verify cache
- MCP server: `forge_run_pipeline` tool over stdio
- Skills: `/forge:triage`, `/forge:spec`, `/forge:go`, `/forge:setup`, `/forge:update` (thinner, CLI-backed)
- Ralph loop: `forge run` for autonomous milestone execution via Claude CLI subprocess
- Pre-commit hook: block direct commits to main, require passing verify cache
- Worktree isolation: create/merge/remove per milestone (~50 lines)
- Version check: once-per-day npm registry check, cached
- Professional README with workflow walkthrough

### Out of Scope (deferred to future enhancements)
- Visual gate (Playwright screenshots) — add after core is stable
- Runtime gate (API endpoint checking) — add after core is stable
- Codex gate (GitHub PR review polling) — add after core is stable
- PRD review gate (AI diff review against acceptance criteria) — add as Layer 3
- Risk tier system (path-based verification rules) — add when needed
- Parallel milestone execution — sequential Ralph loop first
- Multi-PRD execution (`forge run --all`) — single PRD per run
- Test scaffolding / test writing — forge verifies, it doesn't generate tests

### Sacred Files
- `.planning/prds/*.md` — PRD files are human-reviewed artifacts, never auto-modified after approval
- `.planning/status/*.json` — only modified by forge CLI commands, never by agents directly

## Milestones

### Milestone 1: Project Scaffold + Config
**Goal:** Clean TypeScript project with config loading, core types, and CLI entry point. The foundation everything else builds on.

**Issues:**
- [ ] Initialize project: empty src/, tsconfig.json (ES2022, strict, ESM), package.json (version 1.0.0, bin, exports), CLI entry point with Commander
- [ ] Define core types: GateResult, GateError, ForgeConfig, PRDStatus, MilestoneStatus, VerifyCache
- [ ] Implement .forge.json Zod schema with all config fields (gates, gateTimeouts, maxIterations, linearTeam, linearStates, verifyFreshness, forgeVersion)
- [ ] Implement config loader: read .forge.json, validate with Zod, auto-detect fallback (read package.json for TypeScript/Biome/test runner presence)

**Test Cases (PRD-specified):**
- Test: config loader returns defaults when .forge.json is missing
- Test: config loader throws on invalid JSON
- Test: config loader merges auto-detected values with explicit config
- Test: Zod schema rejects unknown fields and invalid types

**Verification:** `tsc --noEmit` compiles with no errors. All specified tests pass.

### Milestone 2: Gates + Verify CLI
**dependsOn:** 1
**Goal:** Pluggable gate registry with three core gates and the `forge verify` CLI command.

**Issues:**
- [ ] Implement gate registry: register gate by name, list registered gates, runPipeline() with sequential execution and per-gate configurable timeout (default 2min)
- [ ] Implement types gate: spawn `tsc --noEmit`, parse output into structured errors (file, line, message)
- [ ] Implement lint gate: spawn `biome check`, parse output into structured errors
- [ ] Implement tests gate: detect runner (Vitest/Jest), spawn it, parse results
- [ ] Wire `forge verify` CLI command: --gate flag (filter to specific gates), --json flag (structured output), exit code 0/1
- [ ] Implement verify cache: write results to .forge/last-verify.json after each verify run

**Test Cases (PRD-specified):**
- Test: gate registry runs gates in registered order
- Test: gate registry respects per-gate timeout (gate that hangs is killed after timeout)
- Test: runPipeline returns structured results with per-gate pass/fail and errors
- Test: types gate parses tsc error output into { file, line, message } format
- Test: verify cache writes valid JSON with timestamp and gate results
- Test: `forge verify --json` outputs parseable JSON to stdout

**Verification:** `tsc --noEmit` compiles. All specified tests pass. `npx forge verify` runs successfully against forge's own codebase.

### Milestone 3: State & Linear
**dependsOn:** 2
**Goal:** PRD status file management and unified Linear client with deterministic sync. All Linear IDs stored at spec time.

**Issues:**
- [ ] Implement PRD status reader: load .planning/status/<slug>.json, validate with Zod schema
- [ ] Implement PRD status writer: update milestone status (pending → in_progress → complete), write atomically
- [ ] Implement status discovery: scan .planning/status/ for all status files, find next pending milestone per PRD
- [ ] Implement Linear client wrapper around @linear/sdk: team-scoped operations (list projects, create milestone, create issue, update project state, update issue state)
- [ ] Implement Linear sync module (one file, one code path): syncMilestoneStart (issues → inProgress, project → inProgress), syncMilestoneComplete (issues → done; if last milestone: project → inReview), syncProjectDone (all → done)
- [ ] Implement configurable Linear state mapping: resolve forge transition names to Linear state UUIDs via config + API lookup
- [ ] Wire `forge linear-sync start --slug <s> --milestone <n>` CLI command
- [ ] Wire `forge linear-sync complete --slug <s> --milestone <n> [--last]` CLI command
- [ ] Wire `forge linear-sync done --slug <s>` CLI command
- [ ] Wire `forge status` CLI command: show PRD progress table, Linear state, next pending milestone

**Test Cases (PRD-specified):**
- Test: status reader loads valid JSON and rejects malformed files
- Test: status writer updates milestone status atomically (temp file + rename)
- Test: status discovery finds all status files and identifies pending milestones
- Test: Linear sync module calls correct state transitions (mock SDK calls)
- Test: configurable state mapping resolves custom state names

**Verification:** `tsc --noEmit` compiles. All specified tests pass. `forge status` displays PRD progress.

### Milestone 4: Ralph Loop Runner + Worktrees
**dependsOn:** 3
**Goal:** `forge run` executes milestones autonomously via Ralph loop with worktree isolation and full visibility.

**Issues:**
- [ ] SPIKE: Validate Claude CLI subprocess behavior — test `claude -p "prompt" --dangerously-skip-permissions`, verify exit codes, output streaming, error handling
- [ ] Implement worktree manager: createWorktree(path, branch, baseBranch), mergeWorktree(branch, targetBranch), removeWorktree(path) — 3 functions, ~50 lines
- [ ] Implement prompt builder: read PRD milestone section, append last verify errors (if any), append rules (verify before finishing, no novelty tests)
- [ ] Implement Ralph loop: create worktree → build prompt → spawn claude subprocess → stream stdout/stderr → wait for exit
- [ ] After Claude exits: run `forge verify --json` in the worktree → parse results
- [ ] On verify pass: update status file, call linear sync, merge worktree back to PRD branch, advance to next milestone
- [ ] On verify fail: rebuild prompt with structured error context, loop again (same milestone)
- [ ] Max iterations guard: after N failures on same milestone, exit with clear error message
- [ ] Wire `forge run --prd <slug>` CLI command with streaming output
- [ ] Wire `forge update` CLI command: check npm registry (once-per-day cache), install if newer version available

**Test Cases (PRD-specified):**
- Test: prompt builder includes PRD milestone section and error context
- Test: worktree create/merge/remove lifecycle works (integration test with real git repo)
- Test: Ralph loop exits after max iterations
- Test: Ralph loop advances to next milestone on verify pass
- Test: version check respects once-per-day cache

**Verification:** `tsc --noEmit` compiles. All specified tests pass. `forge run` can execute at least one Ralph loop iteration (may require Claude CLI to be available).

### Milestone 5: MCP Server & Setup
**dependsOn:** 2
**Goal:** MCP server exposing the pipeline tool, `forge setup` for full project onboarding, pre-commit hook, and doctor.

**Issues:**
- [ ] Implement MCP server with stdio transport: one tool `forge_run_pipeline` that accepts projectDir and optional gates[], returns structured JSON results
- [ ] Implement `forge setup` CLI: generate .forge.json (list Linear teams via SDK, user picks one), install skill files to ~/.claude/commands/forge/, install pre-commit hook, add forge context to CLAUDE.md, validate Linear connection
- [ ] Implement pre-commit hook: block direct commits to main/master, check .forge/last-verify.json exists with result "PASSED"
- [ ] Implement `forge doctor`: check Node >= 18, git, gh CLI, LINEAR_API_KEY set, Linear API key valid (test call), configured Linear team accessible
- [ ] Implement postinstall script: print setup instructions on `npm install -g forge-cc`

**Test Cases (PRD-specified):**
- Test: MCP server responds to forge_run_pipeline tool call with structured gate results
- Test: pre-commit hook blocks commits when verify cache shows FAILED
- Test: pre-commit hook allows commits when verify cache shows PASSED
- Test: doctor reports missing dependencies clearly

**Verification:** `tsc --noEmit` compiles. All specified tests pass. MCP server responds to tool calls. `forge setup` generates valid config. `forge doctor` runs all checks.

### Milestone 6: Skills & Integration Testing
**dependsOn:** 3, 4, 5
**Goal:** All skill files rewritten as thin orchestrators calling forge CLI commands. End-to-end integration verified.

**Issues:**
- [ ] Rewrite /forge:triage skill: brain dump conversation (LLM-driven), calls Linear MCP tools for reads, forge CLI for project creation
- [ ] Rewrite /forge:spec skill: interview (LLM-driven), calls `forge linear-sync` for milestone/issue creation, writes PRD + status file with all Linear IDs
- [ ] Rewrite /forge:go skill: milestone selection, worktree creation via forge CLI, agent team execution with `forge verify` between waves, calls `forge linear-sync start|complete` at boundaries
- [ ] Rewrite /forge:setup skill: thin wrapper that runs `forge setup` CLI, confirms results
- [ ] Rewrite /forge:update skill: thin wrapper that runs `forge update` CLI
- [ ] Integration test: `forge verify` → `forge status` → `forge linear-sync` end-to-end with mock Linear
- [ ] Integration test: `forge run` executes one milestone loop iteration end-to-end

**Test Cases (PRD-specified):**
- Test: forge verify → forge status → forge linear-sync pipeline works end-to-end
- Test: forge run creates worktree, spawns Claude, verifies, and updates status
- Test: skill files reference only commands that exist in forge CLI

**Verification:** `tsc --noEmit` compiles. All specified tests pass. Each skill file is syntactically valid markdown. Full workflow test: verify → status → linear-sync chain.

### Milestone 7: Documentation
**dependsOn:** 6
**Goal:** Professional README with value propositions, workflow walkthrough, and Linear integration guide. Production-quality documentation for the 1.0.0 release.

**Issues:**
- [ ] Write README.md: elevator pitch (what forge is, why it exists), key features (verification, Ralph loops, Linear sync, worktree isolation), quick start guide
- [ ] Document the full workflow: triage → spec → go/run → PR, with concrete examples showing Linear integration at each step
- [ ] Document configuration: .forge.json reference with all fields, defaults, and examples
- [ ] Document CLI commands: verify, run, status, setup, linear-sync, doctor, update — with usage examples
- [ ] Document skill commands: /forge:triage, /forge:spec, /forge:go, /forge:setup, /forge:update — with workflow descriptions
- [ ] Add architecture overview: module map, design decisions, extension points (adding gates, custom Linear states)

**Verification:** README renders correctly in GitHub. All documented commands exist and work. No broken links or references to v1 code.
