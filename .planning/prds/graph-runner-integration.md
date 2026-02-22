# PRD: Graph Runner Integration

## Problem & Goals

The graph module (`src/graph/`) is complete but nothing consumes it. The runner still reads monolithic PRD markdown via regex (`readMilestoneSection`) and tracks status in `.planning/status/*.json`. This integration wires the graph module into the runner so `npx forge run` can execute requirements from a graph directory.

**Goal:** When a `.planning/graph/{slug}/` directory exists, the runner loads the graph, finds ready requirements, builds prompts from requirement files + overview + dependency context, and executes via the existing worktree/Claude/verify loop. Old PRD-based execution continues to work when no graph directory exists.

**Success criteria:**
- `npx forge run --prd <slug>` auto-detects graph vs PRD format
- Graph-based execution uses `findReady()`, `buildRequirementContext()`, `updateRequirementStatus()`
- Old milestone-based execution is untouched (zero regressions)
- Format detection is directory existence check — no config changes

## Technical Approach

- **Dual-format detection:** Check `.planning/graph/{slug}/_index.yaml` existence. Graph path if exists, PRD path otherwise.
- **Additive changes only:** Keep all existing functions. Add new graph-aware alternatives alongside.
- **Reuse graph module:** reader, writer, query are already built — this phase is pure wiring.
- **Sequential execution for now:** Execute ready requirements one at a time (parallel waves are a future enhancement).

## Scope

### In Scope
- Format detection (`src/runner/detect.ts`)
- Graph-aware prompt builder (`buildRequirementPrompt` in `src/runner/prompt.ts`)
- Graph-aware Ralph loop (`runGraphLoop` in `src/runner/loop.ts`)
- CLI dispatch branching (`run` and `status` commands)
- Graph-aware Linear sync functions

### Out of Scope
- Deleting old milestone code (Phase 6)
- Rewriting skill files (Phase 5)
- Parallel wave execution (future)
- New CLI commands specific to graphs

### Sacred Files
- `src/graph/*` — do not modify (already complete)
- `src/state/status.ts` — do not modify (old system stays)
- `src/types.ts` — do not modify (`PRDStatus`, `MilestoneStatus` stay)
- `skills/*` — do not modify
- `src/gates/*` — do not modify

## Milestones

### Milestone 1: Prompt Builder + Format Detection
**Goal:** Add the graph-aware prompt builder and format detection module. After this milestone, the codebase can detect graph vs PRD format and build rich prompts from requirement files with dependency context.

**Issues:**
- [ ] Create `src/runner/detect.ts` — `detectFormat(projectDir, slug)` returns `"graph" | "prd"` based on `.planning/graph/{slug}/_index.yaml` existence
- [ ] Add `buildRequirementPrompt()` to `src/runner/prompt.ts` — builds prompt from Requirement + overview + dependency context + verify errors. Reuses existing `formatVerifyErrors()`.
- [ ] Create `tests/runner/detect.test.ts` — tests for both formats, missing directories
- [ ] Add tests for `buildRequirementPrompt()` in `tests/runner/prompt.test.ts` — keep existing milestone prompt tests, add new graph prompt tests

**Wave 1 (2 agents parallel):**
1. **detect-agent**: Create `src/runner/detect.ts` and `tests/runner/detect.test.ts`
   - Creates: src/runner/detect.ts, tests/runner/detect.test.ts
2. **prompt-agent**: Add `buildRequirementPrompt()` to `src/runner/prompt.ts` and add new test cases to `tests/runner/prompt.test.ts`
   - Modifies: src/runner/prompt.ts, tests/runner/prompt.test.ts

### Milestone 2: Graph Loop + CLI Integration
**dependsOn:** 1
**Goal:** Wire the graph execution path into the Ralph loop and CLI. After this milestone, `npx forge run --prd <slug>` auto-detects format and executes requirements from a graph directory.

**Issues:**
- [ ] Add `runGraphLoop()` to `src/runner/loop.ts` — graph-based execution using findReady, buildRequirementPrompt, updateRequirementStatus, worktree per requirement
- [ ] Update CLI `run` command in `src/cli.ts` to call `detectFormat()` and dispatch to `runGraphLoop()` or `runRalphLoop()`
- [ ] Update CLI `status` command in `src/cli.ts` to display graph progress alongside PRD progress
- [ ] Add graph-aware Linear sync functions to `src/linear/sync.ts` — `syncRequirementStart()`, `syncGraphProjectDone()`
- [ ] Create `tests/runner/graph-loop.test.ts` — tests for graph loop execution, requirement completion, deadlock detection

**Wave 1 (1 agent):**
1. **loop-agent**: Add `runGraphLoop()` to `src/runner/loop.ts`, create `tests/runner/graph-loop.test.ts`, add graph-aware sync to `src/linear/sync.ts`
   - Modifies: src/runner/loop.ts, src/linear/sync.ts
   - Creates: tests/runner/graph-loop.test.ts

**Wave 2 (1 agent):**
1. **cli-agent**: Update `src/cli.ts` — import detect, branch `run` command, update `status` command to show graphs
   - Modifies: src/cli.ts
