---
name: forge-build
hooks:
  WorktreeCreate:
    - hooks:
        - type: command
          command: "node \"$CLAUDE_PROJECT_DIR/node_modules/forge-cc/hooks/linear-worktree-create.js\""
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "node \"$CLAUDE_PROJECT_DIR/node_modules/forge-cc/hooks/linear-branch-enforce.js\""
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "node \"$CLAUDE_PROJECT_DIR/node_modules/forge-cc/hooks/linear-post-action.js\""
          async: true
---

# /forge:build — Graph Execution with Adversarial Review

Orchestrates requirement graph execution with worktree isolation, adversarial review, and Linear state transitions. Replaces `/forge:go`.

**Trigger:** `/forge:build` or `/forge:build --prd <slug>`

## Prerequisites

- Requirement graph exists in `.planning/graph/{slug}/` (created by `/forge:plan`)
- `LINEAR_API_KEY` set in environment
- `.forge.json` with `linearTeam` configured
- `ForgeLinearClient` available from `forge-cc`

## Instructions

Follow these steps exactly. Each requirement is executed in isolation, reviewed adversarially, and merged only on success.

---

### Step 0 — Load Graph

Load the requirement graph and determine what's ready to execute.

```
index = loadIndex(projectDir, slug)
ready = findReady(index)
```

**If `--prd <slug>` is provided:** Use that slug directly.

**If no slug provided:** Scan `.planning/graph/` for available graphs.
- If exactly one graph exists, use it.
- If multiple exist:

<AskUserQuestion>
question: "Multiple graphs found. Which project should I build?"
options:
  - "{slug-1}: {title-1}"
  - "{slug-2}: {title-2}"
  - ...
</AskUserQuestion>

**After loading:**

- If `isProjectComplete(index)` is true:
  Print: "All requirements in {slug} are complete. Nothing to build."
  Exit.

- If `ready.length === 0` and there are pending requirements:
  Print: "All pending requirements are blocked. Here are the blockers:"
  List each blocked requirement and what it's waiting on.
  Exit.

- If `ready.length > 0`:
  Print: "Found {N} ready requirements out of {total} total. Starting execution."
  Proceed to Step 1.

---

### Step 1 — Execution Loop

Execute requirements in parallel waves using `computeWaves()`. Each wave contains requirements whose dependencies are satisfied. Requirements within a wave run in parallel; waves run sequentially.

```
waves = computeWaves(index)

for each wave in waves:
  // Filter to pending/ready requirements only — skip already-complete ones
  waveReqs = wave.filter(reqId => index.requirements[reqId].status !== "complete")
  if (waveReqs.length === 0) continue  // entire wave already complete

  if (waveReqs.length === 1):
    // Sequential fallback — no team overhead for a single requirement
    reqId = waveReqs[0]
    Spawn a builder agent via Task tool with isolation: "worktree"
    The builder executes Step 2 (build → verify → adversarial review)

    if (result === "complete"):
      updateRequirementStatus(projectDir, slug, reqId, "complete")
      mergeWorktree()
    else if (result === "failed"):
      handleFailure(index, reqId, result.errors)  // Step 4

  else:
    // Parallel execution — spawn agent team for the wave
    Create team via TeamCreate (team_name: "{slug}-wave-{N}")
    For each reqId in waveReqs:
      Create task via TaskCreate (subject: reqId, description: requirement prompt)
      Spawn builder agent via Task tool with:
        - isolation: "worktree"
        - team_name: "{slug}-wave-{N}"
        - The builder executes Step 2 independently

    Coordinate: wait for all builders to complete
    For each completed requirement:
      updateRequirementStatus(projectDir, slug, reqId, "complete")
      mergeWorktree()
    For each failed requirement:
      handleFailure(index, reqId, result.errors)  // Step 4

  // Between waves — checkpoint:
  Restage all files (git add -A && git reset)  // parallel agents disrupt each other's index
  Run npx tsc --noEmit                         // catch integration issues before next wave
  index = loadIndex(projectDir, slug)           // pick up status changes and corrections
  Check for discovered requirements or graph corrections (see Step 5)
```

**Wave ordering:** `computeWaves(index)` returns `string[][]` — an array of waves, each wave an array of requirement IDs. Within each wave, requirements have no mutual dependencies and can run in parallel. Waves are ordered so that all dependencies of wave N are in waves 0..N-1.

**Always delegate to builder agents** for implementation work, even for sequential (single-requirement) waves. The point is preserving the orchestrator's context window, not just parallelism.

---

### Step 2 — Per-Requirement Execution

Each requirement goes through a full lifecycle: worktree creation, building, verification, adversarial review, and merge.

#### 2a. Worktree Lifecycle

Each requirement gets its own isolated worktree:

| Phase | Action | Details |
|-------|--------|---------|
| Create | `createWorktree(projectDir, branch)` | Branch: `feat/{slug}/{reqId}` |
| Build | Agent works in worktree | Claude session with requirement prompt |
| Verify | Run forge verification gates | `types`, `lint`, `tests` in the worktree |
| Review | Adversarial review | Separate agent checks reality against spec |
| Merge | `mergeWorktree()` | Merges branch into `feat/{slug}` |
| Cleanup | `removeWorktree()` | After successful merge only |

**On verification or review failure:** The agent retries in the SAME worktree (up to max iterations). The worktree is NOT cleaned up until the requirement completes or is marked failed.

#### 2b. Prompt Construction

Build the agent prompt for each requirement. Loading order matters — most important content goes LAST (attention-sharp zone):

1. **Overview** — project context, tech approach, scope (from `overview.md`)
2. **Transitive deps** — requirement files in topological order, deps-first (from `buildRequirementContext(index, reqId)`)
3. **Completed dep artifacts** — actual file contents created/modified by completed dependencies. The code IS the summary — inline actual code from created files into downstream agent prompts. Never use predicted/spec types.
4. **Target requirement** — the actual requirement file content (LAST = highest attention)

**Context budget priority** (if window is tight):

| Priority | Content | Action if tight |
|----------|---------|-----------------|
| 1 (highest) | Target requirement | Always include in full |
| 2 | Completed dep artifacts | Include actual file contents |
| 3 | Overview | Summarize if needed |
| 4 | Transitive dep requirements | Summarize or truncate |
| 5 (lowest) | Codebase files | Omit — agent can read them |

#### 2c. Build Iterations

Max **3 iterations** per requirement:

| Iteration | Agent Action |
|-----------|-------------|
| 1 | Build from prompt — implement the requirement |
| 2 | Fix verification failures from iteration 1 (if any) |
| 3 | Fix remaining issues from iteration 2 (if any) |

Each iteration follows this cycle:
```
build/fix → verify gates (types, lint, tests) → adversarial review
```

Run `npx tsc --noEmit` between every iteration — catches integration issues before the next attempt.

If iteration passes both verification AND review: requirement is complete.
If iteration 3 fails: proceed to failure handling (Step 4).

---

### Step 3 — Adversarial Review

See `ref/adversarial-review.md` for the full protocol.

The reviewer is a **separate agent** — NOT the builder. It receives:
- The requirement file (acceptance criteria, technical approach)
- The actual files on disk in the worktree post-change
- NOT the diff. NOT the builder's summary. It checks reality against spec.

**Review checklist:**

1. **Acceptance criteria met** — Every criterion in the requirement is behaviorally satisfied
2. **No stub implementations** — No empty functions, TODO comments, hardcoded returns, or placeholder logic
3. **File scope respected** — Files listed in the requirement's `creates`/`modifies` were actually created/modified
4. **No unintended side effects** — Files outside the requirement's scope were not modified unexpectedly

**Review output:** `PASS` or `FAIL` with specific findings.

**If FAIL:** Findings feed back into the next build iteration as error context. The builder agent receives the exact findings and must address each one.

**Always delegate to builder agents** for implementation work, even for sequential tasks. The point is preserving the orchestrator's context window, not parallelism.

---

### Step 4 — Failure Handling

When a requirement fails verification after max iterations (3):

<AskUserQuestion>
question: "Requirement {reqId} ('{title}') failed after 3 iterations. The remaining issues are:
{list of failures}

How would you like to proceed?"
options:
  - "Skip and continue — keep as in_progress, move to next ready requirement"
  - "Retry with more iterations — reset iteration count and try again"
  - "Stop execution — halt the build loop entirely"
  - "Open forge:fix — switch to surgical fix mode for this requirement"
</AskUserQuestion>

**Behavior for each option:**

| Option | Action |
|--------|--------|
| Skip and continue | Requirement stays `in_progress` (NOT complete). Requirements depending on it become blocked. Build loop continues with other ready requirements. Worktree is preserved for later `forge:fix`. |
| Retry with more iterations | Reset iteration count to 0. Re-enter the build cycle for this requirement. |
| Stop execution | Halt the build loop. Print current progress summary. Worktree is preserved. |
| Open forge:fix | Switch to `/forge:fix` mode targeting this specific requirement and worktree. |

---

### Step 5 — Discovered Requirements and Graph Corrections

During execution, agents may discover issues with the graph. See `ref/graph-correction.md` for the full correction protocol.

**Types of discoveries:**

| Discovery | Description | Handling |
|-----------|-------------|----------|
| New requirements | Functionality not in the original graph | Added as `disc-NNN` with `discovered` status in index. Surfaced to user. |
| Missing dependency edges | req-005 actually needs req-002 done first | Proposed as `addEdge(from, to)`. Applied if user approves (or auto-applied in `--auto` mode if no cycle). |
| Wrong file scoping | Requirement touches files not listed in scope | Applied silently to `_index.yaml` |
| Group ordering corrections | Group B should depend on Group A | Surfaced to user for approval |

**At each checkpoint (between requirements):**

If the builder agent reports any discoveries:

1. **New requirements:**
   Print: "Builder discovered a new requirement: {description}"

<AskUserQuestion>
question: "Add this as a new requirement to the graph?"
options:
  - "Yes — add it as discovered"
  - "No — skip it"
  - "Yes, and it depends on {reqId}"
</AskUserQuestion>

2. **Missing edges:**
   Print: "Builder found that {reqId-A} actually depends on {reqId-B}."
   Run `detectCycles()` before applying. If adding the edge would create a cycle, reject it and report.

3. **File scope corrections:**
   Apply silently — update `_index.yaml` via `writeIndex()`.

4. **Group ordering corrections:**
   Surface to user for approval before applying.

---

### Step 6 — Ship and Codex Review

When the execution loop ends and `isProjectComplete(index)` is true:

1. **Ship the PR:**
   ```bash
   git push -u origin feat/{slug}
   gh pr create --title "{project title}" --body "..."
   ```
   Push the branch and create a PR. The PostToolUse hook automatically links the PR to Linear issues and transitions the project to In Review — no manual `forge linear ship` needed.

2. **Codex Review:** If a PR was created, follow the **Codex Review Protocol** in `ref/codex-review.md`.

   **This step is mandatory.** Do not skip to the summary step until the Codex review protocol completes (either comments were resolved or polling timed out with no review found).

---

### Step 7 — Completion

Determine the final state:

**If all requirements are complete:**

Print the completion summary:

```
## Build Complete: {project title}

**Slug:** {slug}
**Requirements completed:** {completed} / {total}
**Waves executed:** {count}
**Linear Project:** {project URL} — In Review

All requirements verified and merged.
```

**If the loop ended with blocked/discovered requirements:**

```
## Build Paused: {project title}

**Slug:** {slug}
**Completed:** {completed} / {total}
**Blocked:** {blocked count} (waiting on dependencies)
**Discovered:** {discovered count} (new requirements found during execution)

### Blocked Requirements
{for each blocked: reqId, title, what it's waiting on}

### Next Steps
1. Run `/forge:fix` to address blocked requirements
2. Run `/forge:build {slug}` to resume execution
```

---

## Linear State Reference

All state transitions are handled automatically by hooks and Linear's GitHub integration. No manual sync calls are needed during build execution.

| Item | Transition | Triggered By |
|------|-----------|-------------|
| Issue | Planned → In Progress | **WorktreeCreate hook** — fires when builder agent worktree is created |
| Project | Planned → In Progress | **WorktreeCreate hook** — first requirement starts |
| Issue | In Progress → In Review | **Linear GitHub integration** — PR opened from branch containing issue identifier |
| Project | In Progress → In Review | **PostToolUse hook** — fires when `gh pr create` succeeds |
| Issue | In Review → Completed | **Linear GitHub integration** — PR merged |
| Project | In Review → Completed | **PostToolUse hook** — fires when `gh pr merge` succeeds |

**If any Linear transition fails:** Hooks log warnings to stderr and continue. Never block execution on Linear API failures.

---

## Context Budget

Keep these limits during execution to preserve the orchestrator's context window:

| Item | Budget |
|------|--------|
| Orchestrator context | Track wave progress only — delegate all implementation to builder agents |
| Builder prompt | Target requirement + completed dep artifacts + overview + transitive deps |
| Review prompt | Requirement file + actual files on disk — no diffs, no builder summaries |
| Between-wave checkpoint | Restage files, run `tsc --noEmit`, reload index, check discoveries |

---

## Key References

- `ref/adversarial-review.md` — Full review protocol (reviewer receives requirement file + actual files on disk, NOT diff/builder summary; stub detection; PASS/FAIL output)
- `ref/codex-review.md` — Codex auto-review polling, evaluation, and resolution protocol
- `ref/graph-correction.md` — Mid-execution correction protocol (discovered reqs, missing edges, file scope, group ordering; checkpoint timing; auto-apply rules)
- `ref/requirement-sizing.md` — Sizing rules (hard/soft limits, splitting guide)

## Graph Module API

These TypeScript functions are available for graph operations:

- `loadIndex(projectDir, slug)` — Load `_index.yaml` from `.planning/graph/{slug}/`
- `writeIndex(projectDir, slug, index)` — Write `_index.yaml`
- `findReady(index)` — Return requirement IDs with all deps complete
- `computeWaves(index)` — Group requirements into parallel execution waves
- `detectCycles(index)` — Check for circular dependencies
- `isProjectComplete(index)` — Check if all requirements are complete
- `buildRequirementContext(index, reqId)` — Return transitive deps in topological order
- `updateRequirementStatus(projectDir, slug, reqId, status)` — Update a requirement's status
- `createWorktree(projectDir, branch)` — Create a git worktree for isolated execution
- `mergeWorktree()` — Merge worktree branch back into the feature branch
- `removeWorktree()` — Clean up worktree after merge
