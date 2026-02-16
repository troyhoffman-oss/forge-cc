# /forge:go — Execute Milestones with Wave-Based Agent Teams

Execute milestones from your PRD with wave-based agent teams, self-healing verification, and automatic state management.

## Instructions

Follow these steps exactly. The execution engine at `src/go/executor.ts` provides the programmatic logic — this skill drives the agent orchestration.

### Step 1 — Orient

Read project state files to determine current position:

```
Read these files in parallel:
- CLAUDE.md
- .planning/STATE.md
- .planning/ROADMAP.md
```

From STATE.md, extract:
- **Current milestone number** (from `**Milestone:**` field)
- **Branch** (from `**Branch:**` field)
- **Active PRD path** (from `**Active PRD:**` field)

From ROADMAP.md, find the next milestone with status "Pending". If STATE.md says the current milestone is complete, advance to the next pending one.

If no active PRD exists:

> No active PRD found. Run `/forge:spec` first to create a PRD with milestones.

If all milestones are complete:

> All milestones complete! Create a PR with `gh pr create` or run `/forge:spec` to start a new project.

### Step 1.5 — Choose Execution Mode

**Unless `--auto` was passed as an argument**, prompt the user to choose their execution mode using AskUserQuestion:

```
Question: "How should this project be executed?"
Header: "Mode"
Options:
  1. Label: "Single milestone"
     Description: "Execute the next milestone, then stop. Good for reviewing progress between milestones or when context is tight."
  2. Label: "Auto (all milestones)"
     Description: "Chain all remaining milestones with fresh context between each. Prints continuation instructions after each milestone completes."
```

If `--auto` was passed as an argument, skip this prompt and proceed in auto mode.

Store the user's choice and apply it in Step 8 (Route Next).

### Step 2 — Pre-flight Checks

Verify the execution environment is ready:

1. **Branch check:** Confirm you are on the correct feature branch (from STATE.md). If on `main`/`master`, warn and abort:

   > You're on the main branch. Switch to your feature branch first: `git checkout {branch}`

2. **Milestone exists:** Read ONLY the current milestone section from the PRD (progressive disclosure — NOT the full PRD). Use the executor's `readCurrentMilestone()` approach — match `### Milestone N:` header and extract until the next milestone header.

3. **Not already complete:** Check ROADMAP.md to confirm this milestone is not already marked complete. If it is, advance to the next pending milestone.

4. **Clean state:** Run `git status` to check for uncommitted changes. If dirty, warn:

   > You have uncommitted changes. Commit or stash them before running /forge:go.

Print the pre-flight summary:

```
## Pre-flight Check

- Branch: feat/forge-build (OK)
- Milestone: 4 — Execution Engine (go) (Pending)
- PRD: .planning/prds/forge-build.md (found)
- Working tree: clean

Ready to execute Milestone 4.
```

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

Update project state files:

1. **STATE.md:** Update the milestone progress table — mark the completed milestone's status as `Complete ({date})`. If there is a next milestone, update the `**Milestone:**` line to point to it. Update `**Last Session:**` to today's date.

2. **ROADMAP.md:** Update the milestone table row to `Complete ({date})`.

3. **Session memory:** Write session state for the current branch using the writer module's pattern.

4. Commit the state updates:

   ```bash
   git add .planning/STATE.md .planning/ROADMAP.md
   git commit -m "docs: mark Milestone {N} complete, update session state"
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

**Next:** Run `/clear` to reset context, then `/forge:go` for Milestone {N+1}: {Next Milestone Name}.
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

When the user selects "Auto (all milestones)" in Step 1.5 or invokes with `--auto` (e.g., `/forge:go --auto`), chain all remaining milestones with context resets between each.

After each milestone completes (Step 5-7):

1. Print the completion summary for the milestone.
2. Print instructions for the context reset:

   ```
   ## Context Reset for Milestone {N+1}

   Milestone {N} is complete and committed. Starting fresh context for the next milestone.

   To continue autonomously, start a new session and run:
   > /forge:go --auto

   The new session will read STATE.md (just updated) and pick up at Milestone {N+1}.
   ```

**IMPORTANT:** Auto mode does NOT continue in the same context window. Each milestone gets a fresh context (the Ralph Loop pattern). The `--auto` flag simply means "after completing this milestone, print the instructions for continuing" rather than "execute everything in one session."

This prevents context rot — each milestone starts with clean context reading CLAUDE.md + STATE.md + current milestone section only (~20% of context window).

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
- **Already on correct milestone:** If STATE.md's current milestone matches the target, proceed normally (this is the expected case).
- **Linear auth fails:** Warn but continue execution. Linear sync is not blocking.
