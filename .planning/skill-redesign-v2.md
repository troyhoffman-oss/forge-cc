# Skill Redesign v2 — Complete Structures

## File Layout

```
skills/
  forge-capture.md        # ~150 lines — brain dump → Linear
  forge-plan.md           # ~280 lines — interview → requirement graph
  forge-build.md          # ~300 lines — graph execution with adversarial review
  forge-fix.md            # ~150 lines — surgical recovery
  forge-quick.md          # ~100 lines — ad-hoc tasks
  forge-setup.md          # unchanged
  forge-update.md         # unchanged
  ref/
    adversarial-review.md   # review protocol, stub detection heuristics
    requirement-sizing.md   # sizing rules, splitting guide, vertical slice examples
    graph-correction.md     # mid-execution graph fix protocol
```

---

## 1. forge:capture (~150 lines)

**Trigger:** `/forge:capture`
**Purpose:** Brain dump → Linear projects (and optionally issues)

### Step 1: Collect Brain Dump
- User pastes unstructured text (Slack threads, meeting notes, ideas)
- No interview — capture is fast

### Step 2: Extract Projects
- Parse brain dump into candidate projects
- For each project: name, 2-3 sentence description, rough priority (P0/P1/P2)
- Deduplicate against existing Linear projects via `ForgeLinearClient`

### Step 3: Present & Confirm
```
AskUserQuestion:
  "I extracted N projects from your brain dump. Review:"
  [list with name + description + priority]
  Options: "Create all" | "Edit list" | "Cancel"
```

### Step 4: Optional Issue Extraction
```
AskUserQuestion:
  "Want me to also create initial issues for these projects?"
  Options:
    "Yes — extract issues from the brain dump" (recommended)
    "No — just create the projects"
```

If yes:
- Re-scan brain dump for actionable items per project
- Present issues grouped by project for confirmation
- Create issues with state "Planned" (not Todo, not Backlog)

### Step 5: Create in Linear
- Create projects via `client.createProject()`
- If issues requested: `client.createIssueBatch()` with state "Planned"
- Report: "Created N projects, M issues"

### Linear State
- Projects created at: **Planned**
- Issues created at: **Planned**

---

## 2. forge:plan (~280 lines)

**Trigger:** `/forge:plan` or `/forge:plan --from-capture <project-slug>`
**Purpose:** Interview → requirement graph (`.planning/graph/{slug}/`)

### Step 0: Detect Context
- **--from-capture flag:** If provided, load Linear project description as pre-populated context. Skip "what are you building?" — jump to clarifying questions.
- **Existing codebase vs greenfield detection:**
  - Scan for `src/`, `package.json`, `go.mod`, `Cargo.toml`, etc.
  - If existing: "I see an existing codebase. I'll ask about integration points, existing patterns, and sacred files."
  - If greenfield: "Starting from scratch. I'll ask about tech stack, project structure, and initial architecture."

### Step 1: Codebase Scan (existing only)
- Tech stack detection (framework, language, test runner, linter)
- File tree summary (depth 2)
- Identify sacred files (lock files, configs, generated code)

### Step 2: Adaptive Interview
- Start with project-level questions: problem, goals, scope, users
- Branch based on existing vs greenfield:
  - **Existing:** integration points, migration concerns, backward compatibility, existing patterns to follow
  - **Greenfield:** tech stack choices, project structure, deployment target, key libraries
- Converge on: acceptance criteria per behavior, file scope estimates, dependency relationships

**Vertical slice enforcement (CRITICAL):**
The spec agent MUST produce vertical slices, not horizontal layers. Each requirement = one user-facing behavior wired end-to-end across ALL layers.

Bad: "Set up database schema" → "Build API endpoints" → "Create UI components"
Good: "User can log in with email/password" → "User can view their dashboard" → "User can update profile"

Acceptance criteria must be behavioral:
- Good: "User can log in with valid credentials and sees their dashboard"
- Bad: "POST /auth/login returns 200 with JWT token"

### Step 3: Requirement Sizing Check
Before generating the graph, validate each requirement against sizing heuristics.

**Refer to `ref/requirement-sizing.md` for full rules. Key limits:**
- Max 6 acceptance criteria per requirement
- Max 5 files in creates + modifies combined
- Max 1 group worth of scope per requirement
- If a requirement exceeds limits → split into smaller vertical slices

If any requirement is oversized:
```
"req-003 has 15 acceptance criteria and 12 files — that's too large for a single
requirement. I'll split it into 3 vertical slices. Here's my proposal: [...]"
```

### Step 4: Generate Graph
- Write `_index.yaml` with groups, requirements, dependency edges
- Write `overview.md` from interview context
- Write individual requirement `.md` files with frontmatter
- Each requirement gets: id, title, dependsOn, files, acceptance, Context, Technical Approach, Interview Notes

### Step 5: Quiz & Iterate
Present the graph to the user:
```
"Here's the requirement graph for {project}:

Groups: [list with dependency order]
Requirements: [list with deps shown as arrows]
Estimated waves: [output of computeWaves preview]

Questions:
1. Granularity right? Any requirement too big or too small?
2. Dependencies correct? Anything that should depend on something else?
3. Slices missing? Any user-facing behavior not covered?
4. Sacred files correct? Anything I should not touch?"
```

**Iterate until the user approves.** Do not commit until they say "looks good."

### Step 6: Linear Sync
- Create Linear project (state: **Planned**)
- Create Linear issues per requirement (state: **Planned**)
- Store IDs in `_index.yaml` via `writeIndex()`
- Commit graph directory to feature branch

### Context Budget (for the spec agent itself)
- Codebase scan: ~2K tokens
- Interview transcript: grows during conversation
- Existing graph (if iterating): load via `loadIndex()` only

---

## 3. forge:build (~300 lines)

**Trigger:** `/forge:build` or `/forge:build --prd <slug>`
**Purpose:** Execute requirement graph with adversarial review

### Step 0: Load Graph
```
index = loadIndex(projectDir, slug)
ready = findReady(index)
```
If no ready requirements: check if project is complete → report and exit.
If all pending are blocked: report blockers and exit.

### Step 1: Execution Loop

```
while (!isProjectComplete(index)) {
  ready = findReady(index)
  if (ready.length === 0) break  // all blocked or discovered

  // Execute first ready requirement (sequential for now)
  // Future: computeWaves() for parallel execution
  reqId = ready[0]  // priority desc → group order → insertion order

  result = executeRequirement(index, reqId)

  if (result === "complete") {
    updateRequirementStatus(projectDir, slug, reqId, "complete")
    syncRequirementDone(client, index, reqId)  // Issue → Done
  } else if (result === "failed") {
    // FAILURE PATH — see below
    handleFailure(index, reqId, result.errors)
  }

  // Reload index (may have been modified by graph corrections)
  index = loadIndex(projectDir, slug)
}

syncGraphProjectDone(client, index)  // Project → Done
```

### Execution Order for Parallel-Ready Requirements
`findReady()` may return multiple. Order: priority descending → group order → insertion order. Sequential execution uses `ready[0]`. Future parallel execution uses `computeWaves()`.

### Step 2: Per-Requirement Execution

#### 2a. Worktree Lifecycle
Each requirement gets its own worktree:
1. **Create:** `createWorktree(projectDir, branch)` where branch = `feat/{slug}/{reqId}` (e.g., `feat/auth-system/req-001`)
2. **Build:** Agent works in worktree. Claude session with requirement prompt.
3. **Verify:** Run forge verification gates (types, lint, tests) in worktree.
4. **Review:** Adversarial review (see Step 3).
5. **Merge:** On success, `mergeWorktree()` merges branch into the project's feature branch (`feat/{slug}`). Fast-forward if possible, merge commit otherwise.
6. **Cleanup:** `removeWorktree()` after merge.

If verification or review fails:
- Agent retries in the SAME worktree (up to max iterations)
- Worktree is NOT cleaned up until requirement completes or is marked failed

#### 2b. Prompt Construction
**Loading order matters — most important content last (attention-sharp zone):**

1. **Overview** — project context, tech approach, scope (from `overview.md`)
2. **Transitive deps** — requirement files in topological order, deps-first (from `buildRequirementContext()`)
3. **Completed dep artifacts** — actual file contents created/modified by completed dependencies (the code IS the summary)
4. **Target requirement** — the actual requirement file content (LAST = highest attention)

**Context budget priority (if window is tight):**
Target requirement → completed dep artifacts → overview → transitive dep requirements → codebase files

#### 2c. Build Iterations
Max 3 iterations per requirement:
1. **Iteration 1:** Agent builds from prompt
2. **Iteration 2:** Agent fixes verification failures (if any)
3. **Iteration 3:** Agent fixes remaining issues

Each iteration: build/fix → verify gates → adversarial review

### Step 3: Adversarial Review

**See `ref/adversarial-review.md` for full protocol.**

The reviewer is a separate agent (NOT the builder). It receives:
- The **requirement file** (acceptance criteria, technical approach)
- The **actual files on disk** in the worktree post-change
- NOT the diff. NOT the builder's summary. It checks reality against spec.

Review checks:
1. Every acceptance criterion is met (behavioral verification)
2. No stub implementations (empty functions, TODO comments, hardcoded returns)
3. Files listed in requirement scope were actually created/modified
4. No unintended side effects in files outside scope

Review output: `PASS` or `FAIL` with specific findings.
If FAIL: findings feed back into the next build iteration.

### Step 4: Failure Handling

When a requirement fails verification after max iterations (3):

```
AskUserQuestion:
  "req-003 'User can update profile' failed after 3 attempts."
  "Last errors: [summary]"
  Options:
    "Skip and continue" — mark requirement as 'blocked', continue to next ready
    "Retry with more iterations" — reset iteration count, try again
    "Stop execution" — halt the build loop entirely
    "Open forge:fix" — switch to surgical fix mode for this requirement
```

**"Skip and continue" behavior:**
- Requirement status stays `in_progress` (NOT complete)
- Requirements depending on it become blocked
- Build loop continues with other ready requirements
- Worktree is preserved for later `forge:fix`

### Step 5: Discovered Requirements & Dependencies

During execution, agents may discover:
1. **New requirements** — functionality not in the original graph
2. **Missing dependency edges** — req-005 actually needs req-002 to be done first
3. **Wrong file scoping** — requirement touches files not listed in its scope
4. **Bad group ordering** — group B should depend on group A

**See `ref/graph-correction.md` for the full correction protocol.**

At each checkpoint (between requirements):
- Agent reports discoveries as structured data
- **New requirements:** Added as `discovered` status in index. Surfaced to user.
- **Missing edges:** Proposed as `addEdge(from, to)`. Applied if the user approves (or auto-applied in `--auto` mode if the edge doesn't create a cycle).
- **File scope corrections:** Applied silently to `_index.yaml` (informational, affects wave scheduling)
- **Group ordering corrections:** Surfaced to user for approval (changes execution order)

### Linear State Transitions (per-requirement)
```
Issue:   Planned → In Progress  (when agent starts requirement)
Issue:   In Progress → Done     (when requirement verified + merged)
Project: Planned → In Progress  (once, on first requirement start)
Project: In Progress → Done     (when ALL requirements complete)
```
If any transition fails: log warning and continue. Never block execution on Linear.

---

## 4. forge:fix (~150 lines)

**Trigger:** `/forge:fix <req-id>` or `/forge:fix` (interactive selection)
**Purpose:** Surgical recovery — fix a specific failed/broken requirement

### Step 0: Select Requirement
If no req-id provided:
```
AskUserQuestion:
  "Which requirement needs fixing?"
  [list requirements with status in_progress or failed, with last error summary]
```

### Step 1: Load Context
- Load the requirement file + its direct dependencies
- Load the current state of files on disk (what exists now)
- Load the last verification errors (from the build session, if available)
- Load the adversarial review findings (if available)

### Step 2: Diagnose
Present diagnosis:
```
"req-003 'User can update profile' — current state:
  - Files created: src/routes/profile.ts ✓, src/components/ProfileForm.tsx ✓
  - Verification: types pass, lint pass, tests FAIL (2 failures)
  - Review: FAIL — acceptance criterion 3 not met ('user sees success toast')

  Root cause: ProfileForm.tsx missing toast notification after successful PUT"
```

### Step 3: Fix
- Work in the existing worktree (if preserved from forge:build) or create a new one
- Targeted fix only — do not rewrite the entire requirement
- Run verification + adversarial review after fix

### Step 4: Complete
- If verified: merge worktree, update requirement status to `complete`
- Linear: Issue → Done
- Report result

### Step 5: Resume Build (optional)
```
AskUserQuestion:
  "Requirement fixed. Want to resume the build?"
  Options: "Yes — run forge:build" | "No — done for now"
```

---

## 5. forge:quick (~100 lines)

**Trigger:** `/forge:quick`
**Purpose:** Ad-hoc tasks without planning ceremony

### Step 0: Collect Task
```
AskUserQuestion:
  "What do you need done? (one sentence)"
```

### Step 1: Optional Linear Integration
```
AskUserQuestion:
  "Track this in Linear?"
  Options:
    "Yes — create an issue" (recommended for non-trivial work)
    "No — just do it"
```

If yes:
- Pick team (from .forge.json or ask)
- Create issue with title = task description, state = **Planned**
- Transition to **In Progress** immediately

### Step 2: Execute
- No graph, no requirements, no groups
- Direct execution: build → verify (types + lint + tests)
- Single worktree, single branch (`fix/quick-{timestamp}` or `feat/quick-{timestamp}`)

### Step 3: Complete
- If Linear tracking: transition issue → **Done**
- Create PR or commit to current branch
- Report result

---

## Reference Files

### ref/adversarial-review.md

Full protocol for the adversarial reviewer agent:

**What the reviewer receives:**
- The requirement `.md` file (frontmatter + body)
- The actual file contents on disk (every file listed in requirement scope + any new files created)
- The project overview (for context)

**What the reviewer does NOT receive:**
- The git diff
- The builder agent's summary or explanation
- The builder agent's internal reasoning

**Stub detection heuristics:**
- Functions with empty bodies or only `throw new Error("not implemented")`
- Functions that return hardcoded values matching test expectations
- TODO/FIXME/HACK comments in new code
- Console.log-only implementations
- Test files that only test the happy path when acceptance criteria specify error cases

**Review checklist:**
1. For each acceptance criterion: is it demonstrably met by the code on disk?
2. For each file in `files.creates`: does it exist and contain meaningful implementation?
3. For each file in `files.modifies`: was it actually modified with relevant changes?
4. Are there files modified outside the declared scope? (warning, not failure)
5. Does the implementation match the technical approach in the requirement body?
6. No obvious security issues (SQL injection, XSS, unvalidated input at boundaries)

**Output format:**
```
PASS | FAIL
Findings:
  - [PASS] Criterion 1: "User can log in" — login.ts implements full auth flow
  - [FAIL] Criterion 3: "Failed login shows error" — no error handling in LoginForm.tsx
  - [WARN] File outside scope: modified src/db/schema.ts (not in requirement files list)
```

### ref/requirement-sizing.md

**Hard limits (trigger automatic splitting):**
- > 6 acceptance criteria → split
- > 5 files (creates + modifies combined) → split
- > 2 groups referenced → split (requirement should belong to exactly 1 group)

**Soft limits (trigger a warning during forge:plan):**
- > 4 acceptance criteria → "Consider splitting"
- > 3 files → "Consider splitting"
- Acceptance criteria that span multiple user behaviors → "This is 2+ requirements"

**How to split:**
Each split produces vertical slices:
1. Identify distinct user-facing behaviors in the oversized requirement
2. Each behavior becomes its own requirement with end-to-end scope
3. Add dependency edges between slices where order matters
4. Preserve the original requirement's group assignment

**Vertical slice examples:**
```
BEFORE (horizontal layer — BAD):
  req-001: "Set up auth database tables"
  req-002: "Build auth API endpoints"
  req-003: "Create auth UI components"

AFTER (vertical slice — GOOD):
  req-001: "User can register with email/password"
    creates: src/db/migrations/add-users.ts, src/api/register.ts, src/components/RegisterForm.tsx
  req-002: "User can log in and see dashboard"
    creates: src/api/login.ts, src/components/LoginForm.tsx, src/middleware/auth.ts
    dependsOn: [req-001]
  req-003: "User can reset forgotten password"
    creates: src/api/reset-password.ts, src/components/ResetForm.tsx
    dependsOn: [req-001]
```

### ref/graph-correction.md

**Types of corrections:**

1. **New requirement discovered**
   - Agent creates a `disc-NNN` requirement file
   - Added to index with status `discovered`
   - Surfaced to user at next checkpoint
   - User approves → status becomes `pending`, enters scheduling
   - User rejects → status becomes `rejected` with reason

2. **Missing dependency edge**
   - Agent reports: "req-005 needs req-002 to be done first because [reason]"
   - Validation: does adding this edge create a cycle? (`detectCycles` on proposed graph)
   - If no cycle: apply to `_index.yaml` via `writeIndex()`
   - If cycle: surface to user with explanation

3. **File scope correction**
   - Agent actually touched files not in the requirement's `files` list
   - Update `_index.yaml` requirement's implicit scope (for wave scheduling)
   - Applied silently — this is informational metadata, not a structural change

4. **Group ordering correction**
   - Agent discovers group B should depend on group A
   - Surfaced to user: "Should group 'API Layer' depend on group 'Infrastructure'?"
   - If approved: update `_index.yaml` groups section
   - Requires re-running `computeWaves()` to recalculate execution plan

**Checkpoint timing:**
- After each requirement completes (success or failure)
- Before starting the next requirement
- Graph corrections are applied between requirements, never mid-execution

**Auto-apply rules (in --auto mode):**
- File scope corrections: always auto-apply
- New edges (no cycle): auto-apply
- New requirements: queue for user review (never auto-approve scope changes)
- Group ordering: queue for user review
