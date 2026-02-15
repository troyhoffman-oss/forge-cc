# forge-cc — Build Specification

**Project:** forge-cc (unified dev workflow tool)
**Status:** Ready for execution
**Branch:** feat/forge-build
**Created:** 2026-02-15
**Assigned To:** Troy
**Linear Project:** forge-cc: Build (MSIG-68 through MSIG-75)

## Overview

Unified development workflow tool that replaces the separate Flow plugin (`flow-cc`) and forge-mcp prototype with a single npm package. Combines verification gates, workflow orchestration (skills), Linear lifecycle management, and mechanical enforcement (hooks) into one product. CLI is the backbone; MCP and Claude Code skills are additive layers.

## Problem Statement

Troy's current setup (Flow skills + ad-hoc CLAUDE.md verification + manual Linear management) has critical gaps identified across 8 research documents and 25+ shipped projects:

1. **PRs need rework** — agents ship code that doesn't meet acceptance criteria. Verification is weak string commands (`npx tsc --noEmit && npx biome check`) that agents can skip.
2. **Flow skills are suggestions, not enforcement** — markdown instructions guide but can't enforce. 32 touchpoints audited; only 7 can be mechanically enforced. Steps get skipped session-to-session.
3. **Linear drifts** — triage creates a mix of projects and loose issues. Spec orphans original issues by creating new milestones. Status transitions are inconsistent (3 of 7 automated). Nothing ties together through the kanban.
4. **Manual milestone chaining** — user must manually run `/flow:go` per milestone, `/clear` between sessions. Dead time between milestones ranges from minutes to days.
5. **Context rot** — long sessions degrade agent output quality. No programmatic context reset between milestones (the "Ralph Loop" pattern from OAI).
6. **Two packages to maintain** — Flow plugin and forge-mcp are separate products with separate install/update cycles. Should be one product.
7. **Matt onboarding** — a second developer joining needs a self-documenting, repeatable workflow. Current tribal knowledge doesn't scale.

## Scope

### In Scope
- CLI verification tool (`npx forge verify`) with structured output
- Claude Code pre-commit hooks and git hooks for mechanical enforcement
- MCP server registration (optional, additive)
- Configuration system (`.forge.json`)
- `/forge:triage` skill — brain dump → Linear projects
- `/forge:spec` skill — interview → PRD → Linear milestones + issues
- `/forge:go` skill — execute milestones (manual + auto mode with context resets)
- Rigid, programmatic Linear lifecycle management
- Self-healing verify loop (agents retry on failure, configurable cap)
- Progressive disclosure session start (token-light)
- Multi-developer support (Matt day-1 ready)
- Full test suite (dogfood: use forge to verify forge)

### Out of Scope
- CI/CD GitHub Actions workflow (future enhancement after product ships)
- LLM-assisted PRD compliance checking (future — requires API token management)
- Before/after screenshot diffing (future visual regression)
- Agent-to-agent review integration (future)
- Architectural lint rules (future custom gates)
- IDE-specific plugins (forge works via terminal in any IDE)

### Sacred / Do NOT Touch
- `.planning/research/` — read-only research output. Reference but do not modify.
- `.planning/prds/forge-mcp.md` — research phase PRD. Keep for historical reference.

## User Stories

### US-1: Verification CLI
**Description:** As a developer, I want to run `npx forge verify` and get structured pass/fail results for my code, so that I know exactly what's broken and how to fix it before committing.
**Acceptance Criteria:**
- [ ] `npx forge verify` runs types (tsc), lint (biome), and tests gates sequentially
- [ ] `npx forge verify --gate types,lint` runs only specified gates
- [ ] `npx forge verify --json` outputs structured JSON (`{gates: GateResult[], passed: boolean}`)
- [ ] `npx forge verify --prd <path>` includes PRD acceptance criteria matching (keyword-based for now)
- [ ] Human-readable report printed to stdout by default (markdown format with checkboxes)
- [ ] Exit code 0 when all gates pass, non-zero when any gate fails
- [ ] Each GateResult includes: gate name, pass/fail, errors (with file/line/message), warnings, duration_ms
- [ ] `npx forge status` prints current project state (branch, milestone, Linear status)
- [ ] Works in: standalone terminal, VS Code terminal, Cursor terminal

### US-2: Enforcement Layer
**Description:** As a workflow enforcer, I want commits to be mechanically blocked unless verification has passed, so that unverified code cannot reach a PR.
**Acceptance Criteria:**
- [ ] Claude Code PreToolUse hook intercepts `Bash(git commit)` and checks `.forge/last-verify.json`
- [ ] Hook blocks commit if `last-verify.json` is missing, stale (>10 min), or `passed: false`
- [ ] Hook blocks commits to `main`/`master` branch (wrong-branch protection)
- [ ] Git pre-commit hook (husky) runs `npx forge verify --gate types,lint` for non-Claude contexts
- [ ] MCP server registers gates as tools: `forge_verify_types`, `forge_verify_lint`, `forge_verify_tests`, `forge_run_pipeline`
- [ ] MCP tools return typed GateResult JSON (not string output)
- [ ] Hooks are committed to repo (`.claude/hooks/`, `.husky/`) so all devs get same enforcement on clone
- [ ] `.forge/last-verify.json` written on every `npx forge verify` run with `{passed, timestamp, gates}`

### US-3: Triage Skill
**Description:** As a project owner, I want to dump my sticky notes and ideas into a conversation and have them organized into Linear projects, so that nothing gets lost and everything is plannable.
**Acceptance Criteria:**
- [ ] `/forge:triage` accepts freeform text input (paste, ramble, bullet points — any format)
- [ ] Extracts distinct project ideas from the input
- [ ] Creates Linear **projects** (not loose issues) for each idea with brief descriptions
- [ ] Sets project status to Backlog
- [ ] Presents organized results back to user for confirmation before creating in Linear
- [ ] Handles edge cases: duplicate projects (warns), very vague ideas (asks for clarification)
- [ ] Prints summary: "Created N projects in Linear: [names]"

### US-4: Spec Skill
**Description:** As a project owner, I want to select a Linear project and have an adaptive interview produce a rich PRD with milestones and issues, so that agents can execute without ambiguity.
**Acceptance Criteria:**
- [ ] `/forge:spec` lists incomplete Linear projects and lets user pick one
- [ ] Runs 3 parallel codebase scan agents (structure, UI/routes, data/APIs)
- [ ] Conducts adaptive interview: leads with recommendations based on codebase + research, asks only non-obvious questions
- [ ] Updates PRD draft every 2-3 questions at `.planning/prds/{slug}.md`
- [ ] Generates PRD with: user stories (checkbox acceptance criteria), milestones (wave-based agents), verification commands per milestone
- [ ] Creates Linear **milestones** under the project (one per PRD milestone)
- [ ] Creates Linear **issues** under each milestone (one per user story), with `projectMilestoneId` set
- [ ] Even lightweight projects: minimum 1 milestone + 1 issue
- [ ] Updates project status to Planned
- [ ] PRD `**Branch:**` field set for downstream skill resolution
- [ ] Prints handoff prompt for `/forge:go`

### US-5: Go Skill — Manual Mode
**Description:** As a developer, I want to run `/forge:go` and have it execute the next milestone from my PRD with wave-based agent teams and self-healing verification, so that I can build one milestone at a time with fresh context.
**Acceptance Criteria:**
- [ ] `/forge:go` reads STATE.md to determine current milestone
- [ ] Reads ONLY the current milestone's section from the PRD (progressive disclosure — not the full PRD)
- [ ] Spawns wave-based agent teams per the PRD's milestone definition
- [ ] After each wave: runs `npx forge verify`
- [ ] Self-healing loop: if verify fails, agents get structured errors and retry (up to configurable max, default 5)
- [ ] On success: commits work, pushes to remote branch, updates STATE.md
- [ ] Moves Linear issues to In Progress at start, keeps them In Progress at end
- [ ] If this is the LAST milestone: auto-detects, creates PR, moves Linear to In Review
- [ ] If NOT the last milestone: prints "Milestone N complete. /clear and run /forge:go for next milestone."
- [ ] Session start context: CLAUDE.md + STATE.md + current milestone section only (~20% context window max)

### US-6: Go Skill — Auto Mode
**Description:** As a developer, I want to run `/forge:go --auto` and have it execute ALL remaining milestones autonomously with programmatic context resets between each, so that I can review the final PR without babysitting each milestone.
**Acceptance Criteria:**
- [ ] `/forge:go --auto` executes all remaining milestones sequentially
- [ ] Between milestones: commits, pushes, updates STATE.md, spawns FRESH agent with new context
- [ ] Fresh agent reads CLAUDE.md + STATE.md + next milestone section (Ralph Loop pattern)
- [ ] Each milestone gets a clean context window — no context rot from previous milestones
- [ ] Self-healing verify loop works within each milestone (configurable max iterations, default 5)
- [ ] If a milestone exhausts max iterations: stops auto-chain, reports what's broken, asks user
- [ ] After final milestone: creates PR (not draft), moves Linear issues to In Review
- [ ] PR body includes forge verification report (machine-generated evidence)
- [ ] Total context used per milestone start: ~20% of window

### US-7: Linear Lifecycle
**Description:** As a project manager, I want Linear project/milestone/issue statuses to be updated programmatically at each workflow stage, so that the kanban always reflects reality.
**Acceptance Criteria:**
- [ ] Triage: creates projects with status Backlog
- [ ] Spec: updates project to Planned, creates milestones + issues under project
- [ ] Go (start): issues move to In Progress, project moves to In Progress
- [ ] Go (milestone complete, not last): issues for completed milestone stay In Progress (or custom status)
- [ ] Go (last milestone, PR created): all issues move to In Review, project moves to In Review
- [ ] PR merged (detected via GitHub auto-close): issues move to Done, project to Done when all milestones complete
- [ ] No loose issues — everything lives under a project → milestone hierarchy
- [ ] Milestone progress in Linear reflects actual issue completion percentage
- [ ] forge:go adds progress comments to Linear issues during execution (brief, not verbose)

### US-8: Multi-Developer Support
**Description:** As a team lead onboarding a new developer, I want Matt to install forge-cc and immediately have the same verification, enforcement, and workflow as Troy, with zero tribal knowledge required.
**Acceptance Criteria:**
- [ ] `npm install -D forge-cc` gives Matt the complete stack (CLI, hooks, MCP config)
- [ ] `npx forge verify` works identically for both developers (version-locked)
- [ ] Claude Code hooks installed automatically (or via documented one-liner)
- [ ] MCP server configured via committed `.mcp.json` (both devs get same tools on clone)
- [ ] README includes "Getting Started" section: install → configure → first verify
- [ ] `.forge.json` committed to repo with project defaults — Matt doesn't need to configure anything
- [ ] Linear assignments visible in `/forge:go` — Matt sees his assigned milestones/issues
- [ ] CLAUDE.md includes pointer to forge documentation (progressive disclosure)

## Technical Design

### Project Structure
```
forge-cc/                          (refactored from forge-mcp)
├── src/
│   ├── cli.ts                     # CLI entry point (npx forge)
│   ├── server.ts                  # MCP server entry point
│   ├── gates/                     # Verification gates
│   │   ├── index.ts               # Gate registry + pipeline runner
│   │   ├── types-gate.ts          # tsc --noEmit
│   │   ├── lint-gate.ts           # biome check
│   │   ├── tests-gate.ts          # npm run test
│   │   ├── visual-gate.ts         # Playwright screenshot + console errors
│   │   ├── runtime-gate.ts        # API endpoint validation
│   │   └── prd-gate.ts            # PRD acceptance criteria matching
│   ├── linear/                    # Linear lifecycle management
│   │   ├── client.ts              # Linear MCP tool wrapper
│   │   ├── projects.ts            # Project CRUD + status transitions
│   │   ├── milestones.ts          # Milestone CRUD + progress tracking
│   │   └── issues.ts              # Issue CRUD + status transitions
│   ├── hooks/                     # Hook logic
│   │   └── pre-commit.ts          # Verification check + branch check
│   ├── config/                    # Configuration
│   │   ├── schema.ts              # .forge.json Zod schema
│   │   └── loader.ts              # Config loading + auto-detection
│   ├── reporter/                  # Output formatting
│   │   ├── human.ts               # Markdown report
│   │   └── json.ts                # Structured JSON
│   ├── state/                     # Session state management
│   │   ├── reader.ts              # Read STATE.md, ROADMAP.md, PRD
│   │   └── writer.ts              # Update STATE.md, commit+push
│   └── types.ts                   # Core types (GateResult, ForgeConfig, etc.)
├── skills/                        # Claude Code skill files
│   ├── forge-triage.md            # /forge:triage
│   ├── forge-spec.md              # /forge:spec
│   └── forge-go.md                # /forge:go
├── hooks/                         # Installable hook files
│   └── pre-commit-verify.js       # Claude Code PreToolUse hook
├── tests/                         # Test suite
│   ├── gates/                     # Unit tests per gate
│   ├── cli.test.ts                # CLI integration tests
│   └── fixtures/                  # Test project fixtures
├── .forge.json                    # Default configuration
├── package.json                   # npm package (bin: forge, exports, etc.)
├── tsconfig.json                  # TypeScript config
└── vitest.config.ts               # Test runner config
```

### Key Types
```typescript
interface GateResult {
  gate: string;
  passed: boolean;
  errors: GateError[];
  warnings: string[];
  duration_ms: number;
}

interface GateError {
  file?: string;
  line?: number;
  message: string;
  remediation?: string;
}

interface PipelineResult {
  passed: boolean;
  gates: GateResult[];
  iterations: number;
  report: string;          // Human-readable markdown
}

interface ForgeConfig {
  gates: string[];         // Which gates to run (default: all)
  maxIterations: number;   // Self-healing retry cap (default: 5)
  verifyFreshness: number; // Hook freshness window in ms (default: 600000 = 10min)
  devServer?: {
    command: string;       // e.g., "npm run dev"
    port: number;          // e.g., 3000
    readyPattern?: string; // e.g., "ready on"
  };
  prdPath?: string;        // Path to active PRD
  linearProject?: string;  // Linear project name
}

interface VerifyCache {
  passed: boolean;
  timestamp: string;       // ISO 8601
  gates: GateResult[];
  branch: string;
}
```

### New Dependencies
- `commander` or `yargs` — CLI arg parsing
- `husky` — git hooks
- `vitest` — test runner
- Existing: `@modelcontextprotocol/sdk`, `playwright`, `zod`

### Existing Files to Modify
- `package.json` — rename to forge-cc, add bin/exports/scripts, add dev deps
- `tsconfig.json` — update paths for new directory structure
- `src/types.ts` — extend with ForgeConfig, VerifyCache, GateError types

### Key Existing Code (Reference, Not Sacred)
The gate logic in these files is B+ quality and should be refactored (not rewritten from scratch):
- `src/tools/verify-types.ts` — tsc parsing logic is correct, needs restructuring
- `src/tools/verify-lint.ts` — biome parsing logic is correct, cap-at-50 is smart
- `src/tools/verify-tests.ts` — test runner detection is correct (has a typo on line 81 to fix)
- `src/tools/verify-visual.ts` — Playwright logic is correct, browser lifecycle needs cleanup
- `src/tools/verify-runtime.ts` — API validation logic is correct
- `src/tools/verify-prd.ts` — keyword matching logic is functional (LLM-assisted is future)
- `src/tools/run-pipeline.ts` — pipeline orchestration is correct, needs iteration loop
- `src/utils/browser.ts` — dev server lifecycle is correct
- `src/utils/reporter.ts` — markdown generation is correct

### Configuration (.forge.json)
```json
{
  "gates": ["types", "lint", "tests"],
  "maxIterations": 5,
  "verifyFreshness": 600000,
  "devServer": {
    "command": "npm run dev",
    "port": 3000
  },
  "prdPath": ".planning/prds/active.md",
  "linearProject": "My Project"
}
```
Auto-detection: if no `.forge.json` exists, forge detects project type from `package.json` (has typescript? → types gate, has biome? → lint gate, has test script? → tests gate).

### Skill Installation
Skills (`.md` files) are distributed inside the npm package at `node_modules/forge-cc/skills/`. Claude Code discovers them via the package's configuration. The exact mechanism (symlink to `.claude/skills/`, postinstall script, or Claude Code's native npm skill discovery) will be determined during implementation based on Claude Code's current skill loading behavior.

### Progressive Disclosure — Session Start
When `/forge:go` starts a new milestone, it loads:
1. CLAUDE.md (~100 lines — table of contents, not encyclopedia)
2. STATE.md (<80 lines — current position, last session, next actions)
3. Current milestone section ONLY from the PRD (not the full PRD)

Total: ~200-300 lines of context (~5-8% of window). The rest is available for the actual work.

Deeper docs (full PRD, research, architecture) are referenced by path in CLAUDE.md. Agents read them on-demand when they need specific details.

## Implementation Milestones

### Milestone 1: Core CLI + Verification Engine
**Assigned To:** Troy
**Goal:** `npx forge verify` works with all gates, returns structured results, hooks block bad commits, MCP tools are registered. This is the verification backbone everything else builds on.

**Wave 1 — Foundation (3 agents parallel):**
1. **package-setup**: Refactors `package.json` (name→forge-cc, bin entry, exports, scripts, add vitest/commander). Updates `tsconfig.json` for new `src/gates/` structure. Creates `vitest.config.ts`. Creates `.forge.json` default config. Removes old `src/tools/` after gates are migrated.
   - Creates: `vitest.config.ts`, `.forge.json`
   - Modifies: `package.json`, `tsconfig.json`

2. **types-and-config**: Creates core types (`src/types.ts` — extended), config schema (`src/config/schema.ts`), config loader (`src/config/loader.ts` — loads .forge.json with auto-detection fallback).
   - Creates: `src/config/schema.ts`, `src/config/loader.ts`
   - Modifies: `src/types.ts`

3. **gate-migration**: Refactors all 6 gate functions from `src/tools/verify-*.ts` into `src/gates/*-gate.ts`. Cleans up interfaces, fixes verify-tests typo, adds GateError with file/line/remediation. Creates gate registry (`src/gates/index.ts`) that exports all gates and pipeline runner. Migrates `src/utils/browser.ts` and `src/utils/reporter.ts` into new structure.
   - Creates: `src/gates/types-gate.ts`, `src/gates/lint-gate.ts`, `src/gates/tests-gate.ts`, `src/gates/visual-gate.ts`, `src/gates/runtime-gate.ts`, `src/gates/prd-gate.ts`, `src/gates/index.ts`
   - Modifies: `src/utils/browser.ts`, `src/utils/reporter.ts` (moved/refactored)
   - Deletes: `src/tools/` directory (after migration)

**Wave 2 — CLI + Reporter + MCP (3 agents parallel):**
1. **cli-entry**: Creates `src/cli.ts` with commander: `forge verify [--gate X,Y] [--json] [--prd <path>]`, `forge status`. Writes `.forge/last-verify.json` on every run. Handles exit codes.
   - Creates: `src/cli.ts`

2. **reporter**: Creates `src/reporter/human.ts` (markdown with checkboxes, errors, durations) and `src/reporter/json.ts` (structured PipelineResult JSON). Replaces old `src/utils/reporter.ts`.
   - Creates: `src/reporter/human.ts`, `src/reporter/json.ts`

3. **mcp-server**: Creates `src/server.ts` — MCP server that registers each gate as a tool with Zod-validated input and GateResult output. Thin wrapper over gate functions.
   - Creates: `src/server.ts`

**Wave 3 — Hooks + Tests (3 agents parallel):**
1. **hooks**: Creates Claude Code PreToolUse hook (`hooks/pre-commit-verify.js`) — checks `.forge/last-verify.json` freshness, blocks main/master commits. Creates `src/hooks/pre-commit.ts` with the logic. Sets up husky for git pre-commit hook.
   - Creates: `hooks/pre-commit-verify.js`, `src/hooks/pre-commit.ts`, `.husky/pre-commit`

2. **unit-tests**: Creates unit tests for each gate (mocked external commands), CLI arg parsing, config loading, reporter output.
   - Creates: `tests/gates/*.test.ts`, `tests/cli.test.ts`, `tests/config.test.ts`

3. **integration-test**: Creates a minimal test fixture project (`tests/fixtures/sample-project/`) and integration test that runs `npx forge verify` against it.
   - Creates: `tests/fixtures/sample-project/`, `tests/integration.test.ts`

**Verification:**
```bash
npx forge verify                   # runs and returns structured output
npx forge verify --gate types      # runs only type checking
npx forge verify --json            # outputs JSON
npx tsc --noEmit                   # forge-cc itself compiles
npm test                           # all tests pass
```
**Acceptance:** Covers US-1, US-2.

---

### Milestone 2: Linear Integration + Triage Skill
**Assigned To:** Troy
**Goal:** Linear lifecycle management works programmatically. `/forge:triage` creates projects from brain dumps. Skill installation mechanism works.

**Wave 1 — Linear Layer (3 agents parallel):**
1. **linear-client**: Creates `src/linear/client.ts` — wrapper that calls Linear MCP tools (`mcp__linear__*`) or falls back to direct API. Handles authentication, error handling, and rate limiting.
   - Creates: `src/linear/client.ts`

2. **linear-lifecycle**: Creates `src/linear/projects.ts` (create project, status transitions: Backlog→Planned→In Progress→In Review→Done), `src/linear/milestones.ts` (create milestone, progress tracking), `src/linear/issues.ts` (create issue under milestone, status transitions).
   - Creates: `src/linear/projects.ts`, `src/linear/milestones.ts`, `src/linear/issues.ts`

3. **skill-system**: Determines and implements the skill installation mechanism for Claude Code. Creates the skill loader/installer. Creates the basic `/forge:triage` skill file.
   - Creates: `skills/forge-triage.md`, skill installation mechanism (TBD)

**Wave 2 — Triage Logic + Tests (2 agents parallel):**
1. **triage-engine**: Implements brain dump parsing logic — extracts project ideas from freeform text, deduplicates against existing Linear projects, presents organized results for confirmation, then creates projects via Linear layer.
   - Modifies: `skills/forge-triage.md` (refined with engine integration)

2. **linear-tests**: Creates tests for Linear client, project lifecycle transitions, milestone/issue management. Tests use mocked Linear MCP responses.
   - Creates: `tests/linear/*.test.ts`

**Verification:**
```bash
npm test                           # all tests pass including new Linear tests
npx tsc --noEmit                   # compiles cleanly
```
Manual: `/forge:triage` with sample brain dump → Linear projects created.
**Acceptance:** Covers US-3, US-7 (partial — triage stage).

---

### Milestone 3: Spec Skill
**Assigned To:** Troy
**Goal:** `/forge:spec` produces a rich PRD from an interactive interview and creates Linear milestones + issues. Implements progressive disclosure for token-light session starts.

**Wave 1 — Spec Engine (3 agents parallel):**
1. **codebase-scanner**: Implements the 3-parallel-agent codebase scan (structure, UI/routes, data/APIs) as a reusable module. Returns structured summaries.
   - Creates: `src/spec/scanner.ts`

2. **interview-engine**: Implements the adaptive interview logic — leads with recommendations based on codebase scan, asks non-obvious questions, follows interesting threads, updates PRD draft every 2-3 questions. Improved from flow:spec with: better inference, fewer generic questions, recommendation-led.
   - Creates: `src/spec/interview.ts`, `skills/forge-spec.md`

3. **prd-generator**: Implements PRD markdown generation from interview data — user stories with checkbox criteria, milestones with wave-based agent assignments, verification commands. Template-based with Zod schema validation.
   - Creates: `src/spec/generator.ts`, `src/spec/templates.ts`

**Wave 2 — Linear Integration + Progressive Disclosure (2 agents parallel):**
1. **spec-linear**: Wires PRD generation to Linear — creates milestones under project (one per PRD milestone), creates issues under milestones (one per user story, with `projectMilestoneId`), updates project status to Planned.
   - Creates: `src/spec/linear-sync.ts`

2. **progressive-disclosure**: Implements the token-light session start system — CLAUDE.md as table of contents (~100 lines), STATE.md reader that extracts only current milestone context, PRD reader that extracts only current milestone section. Ensures session start is ~20% of context window.
   - Creates: `src/state/reader.ts`, `src/state/writer.ts`

**Verification:**
```bash
npm test                           # all tests pass
npx tsc --noEmit                   # compiles cleanly
```
Manual: `/forge:spec` on a test project → PRD generated, Linear milestones + issues created.
**Acceptance:** Covers US-4, US-7 (spec stage).

---

### Milestone 4: Execution Engine (go)
**Assigned To:** Troy
**Goal:** `/forge:go` executes milestones with manual and auto modes, self-healing verify loops, context resets between milestones, and automatic PR creation on final milestone.

**Wave 1 — Core Execution (3 agents parallel):**
1. **milestone-executor**: Implements single-milestone execution — reads PRD milestone definition, spawns wave-based agent teams via Task tool, manages wave boundaries, runs forge verify after each wave.
   - Creates: `src/go/executor.ts`, `skills/forge-go.md`

2. **verify-loop**: Implements self-healing verify loop — runs `npx forge verify`, on failure feeds structured errors back to agents, agents retry, loop until pass or max iterations (configurable, default 5). On max iterations: stops, reports what's broken.
   - Creates: `src/go/verify-loop.ts`

3. **state-manager**: Implements between-milestone state management — updates STATE.md with progress, commits work to branch, pushes to remote. Reads STATE.md to determine current milestone. Detects if current milestone is the last one.
   - Modifies: `src/state/writer.ts` (extended for go context)

**Wave 2 — Auto Mode + PR (3 agents parallel):**
1. **auto-chain**: Implements auto mode — after milestone completes, spawns fresh agent (via Task tool) with clean context for next milestone. Fresh agent reads CLAUDE.md + STATE.md + next milestone section only. Loops until all milestones done or max iterations hit.
   - Creates: `src/go/auto-chain.ts`

2. **pr-creation**: Implements final milestone detection → PR creation. Uses `gh pr create` with forge verification report in body. Moves Linear issues to In Review. Updates project status.
   - Creates: `src/go/finalize.ts`

3. **linear-execution**: Wires Linear status transitions into execution flow — issues to In Progress at milestone start, milestone progress updates during execution, issues to In Review on PR creation.
   - Creates: `src/go/linear-sync.ts`

**Verification:**
```bash
npm test                           # all tests pass
npx tsc --noEmit                   # compiles cleanly
```
Manual: `/forge:go` on a test milestone → executes, verifies, commits. `/forge:go --auto` chains milestones with context resets.
**Acceptance:** Covers US-5, US-6, US-7 (go + done stages).

---

### Milestone 5: Integration, Testing + Documentation
**Assigned To:** Troy
**Goal:** End-to-end dogfooding (use forge to verify forge), documentation for Matt, edge case handling, npm publish readiness. The finished product.

**Wave 1 — E2E + Docs (3 agents parallel):**
1. **e2e-tests**: Creates comprehensive E2E test suite using a test fixture project. Tests: full pipeline run, hook blocking, CLI arg combinations, config auto-detection. Uses forge's own test infrastructure.
   - Creates: `tests/e2e/*.test.ts`, expanded `tests/fixtures/`

2. **documentation**: Creates README.md (Getting Started, Configuration, Commands, Skills, Multi-Dev Setup). Updates CLAUDE.md to be the progressive disclosure "table of contents" (~100 lines). Creates AGENTS.md for Codex/non-Claude agent compatibility.
   - Creates: `README.md`, `AGENTS.md`
   - Modifies: `CLAUDE.md` (rewritten as table of contents)

3. **edge-cases**: Handles error recovery (gate crashes, Linear API failures, git conflicts), cleanup on failure (remove stale .forge/ files), graceful degradation (Linear unavailable → skip Linear, MCP unavailable → CLI-only), Windows-specific issues (process lifecycle, path handling).
   - Modifies: various files for error handling

**Wave 2 — Polish + Ship (2 agents parallel):**
1. **npm-publish**: Finalizes package.json for npm publish (name, version, license, files, bin, exports, engines). Tests `npm pack` + `npm install` locally. Ensures skill files are included in package. Creates `.npmignore`.
   - Modifies: `package.json`
   - Creates: `.npmignore`

2. **final-verify**: Runs full forge verify on forge-cc itself (dogfood). Fixes any remaining issues. Runs all tests. Confirms hook installation works. Confirms MCP registration works. Creates the PR for the forge-cc product.
   - Final verification pass

**Verification:**
```bash
npx forge verify                   # forge verifies itself
npm test                           # all tests pass (unit + integration + e2e)
npx tsc --noEmit                   # clean compile
npm pack                           # package builds correctly
```
Manual: Fresh clone → `npm install` → `npx forge verify` works. README is clear for Matt.
**Acceptance:** Covers US-8. Full product verification across all user stories.

## Verification

### Per-Milestone
- **Milestone 1:** `npx forge verify` runs, hooks block bad commits, MCP tools registered, all tests pass
- **Milestone 2:** `/forge:triage` creates Linear projects, Linear status transitions work, tests pass
- **Milestone 3:** `/forge:spec` produces valid PRD with Linear milestones + issues, tests pass
- **Milestone 4:** `/forge:go` executes milestones in manual + auto mode, self-healing loop works, tests pass
- **Milestone 5:** E2E tests pass, npm package ready, README complete, forge verifies itself

### Overall
- forge-cc replaces flow-cc for Troy's daily workflow
- Matt can install and use forge-cc from scratch with only the README
- Linear kanban accurately reflects project state at all times
- No unverified code reaches a PR
- Context window usage at session start is ≤20%
