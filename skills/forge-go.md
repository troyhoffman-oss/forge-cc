# /forge:go — Execute Milestones with Wave-Based Agent Teams

Execute milestones from your PRD with wave-based agent teams, self-healing verification, and automatic state management.

## Instructions

Follow these steps exactly. The execution engine at `src/go/executor.ts` provides the programmatic logic — this skill drives the agent orchestration.

### Step 1 — Orient + Choose Mode

**This step has two parts. Complete BOTH before moving to Step 2. Do NOT read any other files, do NOT start pre-flight checks, do NOT read the PRD until both parts are done.**

**Part A — Read state (only these files, nothing else):**

```
Read these files in parallel:
- CLAUDE.md
- .planning/status/*.json (scan for PRD status files)
```

From the status files, determine:
- **Available PRDs** with pending milestones
- If only one PRD: auto-select it
- If multiple PRDs: present a picker using AskUserQuestion
- **Current milestone number** — the lowest-numbered pending milestone for the selected PRD
- **Branch** — from the status file's `branch` field
- **Active PRD path** — `.planning/prds/<slug>.md`

If no PRD status files exist:

> No PRD status files found. Run `/forge:spec` first to create a PRD with milestones.

If all milestones are complete across all PRDs:

> All milestones complete! Create a PR with `gh pr create` or run `/forge:spec` to start a new project.

**Part B — Ask execution mode (MANDATORY — do this IMMEDIATELY after Part A):**

If `--auto` was passed as an argument, set mode to auto and skip the prompt.

If `--single` was passed as an argument, set mode to single and skip the prompt.

Otherwise: **your very next tool call MUST be AskUserQuestion.** No file reads, no git commands, no exploration — ask the user first. Use exactly these parameters:

- question: "How should this project be executed?"
- header: "Mode"
- options:
  - label: "Single milestone", description: "Execute the next pending milestone, then stop. Good for reviewing progress between milestones."
  - label: "Auto (all milestones)", description: "Chain all remaining milestones with fresh context between each. After each milestone, prints a continuation prompt for the next session."
- multiSelect: false

**Wait for the user's response before continuing.** Do not proceed to Step 2 until you have their answer. Store the choice for Step 8 (Route Next).

### Step 2 — Pre-flight Checks

Verify the execution environment is ready:

1. **Branch check:** Confirm you are on the correct feature branch (from the status file's `branch` field). If on `main`/`master`, warn and abort:

   > You're on the main branch. Switch to your feature branch first: `git checkout {branch}`

2. **Milestone exists:** Read ONLY the current milestone section from the PRD (progressive disclosure — NOT the full PRD). Use the executor's `readCurrentMilestone()` approach — match `### Milestone N:` header and extract until the next milestone header.

3. **Not already complete:** Check the status file to confirm this milestone is not already marked complete. If it is, advance to the next pending milestone.

4. **Clean state:** Run `git status` to check for uncommitted changes. If dirty, warn:

   > You have uncommitted changes. Commit or stash them before running /forge:go.

5. **Milestone size:** Count waves and agents in the milestone. If >3 waves or >6 total agents, warn:

   > Warning: This milestone has {N} waves and {M} agents. Large milestones risk context overflow. Consider splitting before execution.

   This is a pre-flight warning, not a hard abort — the user can choose to proceed. But the warning should be prominent so they can split the milestone first if needed.

Print the pre-flight summary:

```
## Pre-flight Check

- Branch: feat/forge-build (OK)
- Milestone: 4 — Execution Engine (go) (Pending)
- PRD: .planning/prds/forge-build.md (found)
- Working tree: clean

Ready to execute Milestone 4.
```

### Step 2.5 — Session Isolation (Automatic)

The execution engine automatically creates a git worktree for isolated execution. This happens transparently — you don't need to manage it manually.

**What happens behind the scenes:**
1. A worktree is created at `../.forge-wt/<repo>/<session-id>/` based on the feature branch
2. A session is registered in `.forge/sessions.json`
3. All wave execution happens inside the worktree directory
4. After completion, changes are merged back to the feature branch
5. The worktree and session are cleaned up

**Why:** Multiple users or terminals can run `/forge:go` simultaneously without corrupting each other's work. Each session gets an isolated copy of the codebase.

**If worktree creation fails:** The engine falls back to running in the main working directory (original behavior). A warning is printed but execution continues.

### Step 3 — Execute Waves

Parse the milestone section from the PRD. Each milestone contains waves with agent definitions:

```
**Wave N (M agents parallel):**
1. **agent-name**: task description
   - Creates: file1, file2
   - Modifies: file3
```

For each wave, in order:

#### 3a. Build Agent Prompts

For each agent in the wave, construct a prompt that includes:

1. **Agent identity:** "You are **{agent-name}** working on Milestone {N}: {name}."
2. **Milestone goal:** The `**Goal:**` line from the milestone section.
3. **Agent task:** The specific task description from the wave definition.
4. **Files to create/modify:** The explicit file list from the agent's definition.
5. **Existing code context:** Read the actual contents of files the agent depends on (imports, types, utilities). **Inline the actual code** — never reference files by path alone. This is critical for agents that run in isolated contexts.
6. **Lessons:** Read `tasks/lessons.md` and include all active lessons.
7. **Rules:**
   - Use ES module imports with `.js` extension in import paths
   - Stage only your files (never `git add .` or `git add -A`)
   - Run `npx tsc --noEmit` after creating files to verify compilation
   - Do NOT commit — the orchestrator handles commits

#### 3b. Spawn Agents in Parallel

Use the Task tool to spawn all agents in the current wave simultaneously:

```
For each agent in the wave, use the Task tool with:
- The constructed prompt as the task description
- subagent_type appropriate for the work (typically a full-capability agent)
```

Wait for ALL agents in the wave to complete before moving to the next step.

#### 3c. Restage Files at Wave Boundary

**IMPORTANT:** Parallel agents can disrupt each other's git index. After all agents in a wave complete, restage all files:

```bash
git add {all files from this wave's agents}
```

This is a learned lesson — always restage at wave boundaries.

#### 3d. Run Verification

After each wave completes, run forge verification:

```bash
npx tsc --noEmit
```

If the project has additional verification configured (tests, lint), also run:

```bash
npx forge verify
```

If verification **passes**: print a wave completion summary and proceed to the next wave.

```
## Wave {N} Complete

- agent-1: OK (created file1.ts, file2.ts)
- agent-2: OK (modified file3.ts)
- Verification: PASSED

Proceeding to Wave {N+1}...
```

If verification **fails**: proceed to Step 4 (self-healing loop).

### Step 4 — Self-Healing Verify Loop

When verification fails after a wave:

1. Parse the verification errors into structured feedback. Include:
   - Gate name (types, lint, tests)
   - Error messages with file paths and line numbers
   - Remediation hints if available

2. Spawn a **fix agent** with a prompt that includes:
   - The specific errors to fix
   - The files that need modification
   - The original task context
   - "Fix ONLY the errors listed. Do not refactor or add features."

3. After the fix agent completes, restage files and re-run verification.

4. Repeat up to `maxIterations` (default: 5, configurable via `.forge.json`).

5. If max iterations reached without passing:

   ```
   ## Verification Failed After {N} Iterations

   ### Remaining Errors:
   - types: src/go/executor.ts:42 — Type 'string' is not assignable to type 'number'
   - lint: src/go/executor.ts:55 — Unused variable 'foo'

   The self-healing loop could not resolve all errors.
   Please fix the remaining issues manually, then run `/forge:go` again.
   ```

   **Stop execution.** Do not proceed to the next wave or milestone.

### Step 5 — Commit

After ALL waves pass verification:

1. Stage all files created/modified across all waves:

   ```bash
   git add {all files from all waves}
   ```

2. Commit with a structured message:

   ```bash
   git commit -m "feat: {Milestone Name} (Milestone {N})"
   ```

3. Push to the remote branch:

   ```bash
   git push origin {branch}
   ```

### Step 6 — Update State

Update the PRD status file:

1. **Status JSON:** Update `.planning/status/<slug>.json` — mark the completed milestone's status as `complete` with today's date.

2. Commit the status update:

   ```bash
   git add .planning/status/<slug>.json
   git commit -m "docs: mark Milestone {N} complete"
   git push origin {branch}
   ```

### Step 7 — Linear Sync (If Configured)

If the project has a `linearProject` configured in `.forge.json` or the PRD:

1. Transition issues for the completed milestone to appropriate state:
   - If this was the **last milestone**: move issues to "In Review"
   - Otherwise: keep issues as-is (they were set to "In Progress" at start)

2. If this is the **last milestone**, also:
   - Transition the project to "In Review"
   - Create a PR (see Step 8)

If Linear is not configured, skip this step silently.

### Step 8 — Route Next

After milestone completion, determine the next action:

#### If this is NOT the last milestone:

```
## Milestone {N} Complete

**{Milestone Name}** completed successfully.

- Files created: {count}
- Files modified: {count}
- Verification: PASSED
- Branch: {branch} (pushed)

**Next:** Run `/clear` then `/forge:go` for Milestone {N+1}, or exit and run `npx forge run` to auto-chain all remaining milestones.
```

#### If this IS the last milestone:

Create a pull request:

```bash
gh pr create --title "feat: {Project Name}" --body "$(cat <<'EOF'
## Summary
{Brief description from PRD overview}

## Milestones Completed
- [x] Milestone 1: {name}
- [x] Milestone 2: {name}
...

## Verification
All milestones passed forge verification (types, lint, tests).

---
Generated by forge-cc
EOF
)"
```

Then print:

```
## All Milestones Complete!

**PR created:** {PR URL}

- {N} milestones completed
- {total files} files created/modified
- All verification gates passed

The PR is ready for review.
```

### Auto Mode

When the user selects "Auto (all milestones)" in Step 1 Part B or invokes with `--auto` (e.g., `/forge:go --auto`):

Print the following instructions and then **stop** (do not execute a milestone):

```
## Auto Mode — Fresh Context Execution

Auto mode runs each milestone in a fresh Claude session for maximum quality.

**To start:** Exit this Claude session (Ctrl+C), then run in your terminal:

    npx forge run

**What happens:**
- Each milestone gets a fresh Claude session (no context rot)
- Output streams inline to your terminal
- Stops on completion, failure, or stall
- Resume after failure: fix the issue, run `npx forge run` again

**Requires:** claude CLI on PATH, --dangerously-skip-permissions (automatic)
```

**IMPORTANT:** Auto mode does NOT execute milestones in the current session. It redirects the user to `npx forge run`, which handles spawning fresh Claude sessions per milestone via the Ralph Loop pattern.

### Parallel Milestones (dependsOn)

When milestones specify `dependsOn` fields in the PRD, the scheduler can identify which milestones are independent and run them in parallel:

- Milestones with no `dependsOn` (or `dependsOn: []`) can run in the first wave
- Milestones that depend on completed milestones become ready as dependencies finish
- The scheduler builds a DAG and groups milestones into execution waves

Example PRD milestone with dependencies:
```
### Milestone 3: Integration Layer
**dependsOn:** 1, 2
**Goal:** Combine components from M1 and M2...
```

If no `dependsOn` fields are present, milestones execute sequentially (backward compatible).

### Step 9 — Linear Issue Start (On Milestone Begin)

At the START of milestone execution (between Step 2 and Step 3), if Linear is configured:

1. Find issues associated with this milestone in Linear.
2. Transition them to "In Progress".
3. Transition the project to "In Progress" (if not already).
4. Add a brief comment: "Starting execution via forge:go."

If Linear is not configured, skip silently.

## Edge Cases

- **No PRD:** Abort with message to run `/forge:spec` first.
- **No waves in milestone:** The milestone section may not have structured wave definitions (e.g., it was written by hand without the spec engine). In this case, treat the entire milestone as a single wave with one agent whose task is the milestone's goal.
- **Agent failure:** If an agent in a wave fails (exits with error, times out), record the failure, include the error in the wave result, and proceed to verification. The self-healing loop may fix the issue.
- **Branch diverged:** If `git push` fails due to divergence, attempt `git pull --rebase` first. If that fails, stop and ask the user.
- **Interrupted execution:** If execution is interrupted mid-wave, the state files are NOT updated. Running `/forge:go` again will retry the same milestone from the beginning. Completed agents' work will be in the working tree — the new run's verification will detect what's already working.
- **Empty milestone section:** If the PRD has a milestone header but no content, abort with:
  > Milestone {N} has no wave definitions. Update the PRD with agent assignments before running /forge:go.
- **Already on correct milestone:** If the status file's current milestone matches the target, proceed normally (this is the expected case).
- **Linear auth fails:** Warn but continue execution. Linear sync is not blocking.
- **Worktree conflict:** If the worktree directory already exists (e.g., from a crashed session), the engine attempts `npx forge cleanup` first. If that fails, it falls back to main directory execution.
