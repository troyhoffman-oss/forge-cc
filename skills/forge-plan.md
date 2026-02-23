# /forge:plan — Interview to Requirement Graph

Runs an adaptive interview and produces a requirement graph in `.planning/graph/{slug}/`. Replaces `/forge:spec`.

**Trigger:** `/forge:plan` or `/forge:plan --from-capture <project-slug>`

## Instructions

Follow these steps exactly. Do not skip confirmation or commit until the user approves.

---

### Step 0 — Detect Context

Check for the `--from-capture` flag and detect the project type.

**If `--from-capture <project-slug>` is provided:**
- Load the Linear project description for `<project-slug>` using `ForgeLinearClient`
- Use the project description as pre-populated context — skip "what are you building?"
- Jump directly to clarifying questions in Step 2

**Codebase detection — scan the current directory:**

```bash
ls src/ package.json go.mod Cargo.toml pyproject.toml 2>/dev/null
```

- **If existing codebase detected** (any of the above exist):
  Print: "I see an existing codebase. I'll ask about integration points, existing patterns, and sacred files."
  Proceed to Step 1 (Codebase Scan).

- **If greenfield** (none of the above exist):
  Print: "Starting from scratch. I'll ask about tech stack, project structure, and initial architecture."
  Skip Step 1, proceed to Step 2.

---

### Step 1 — Codebase Scan (Existing Only)

Gather context about the existing project. Keep the scan under ~2K tokens.

1. **Tech stack detection:**
   - Read `package.json` (or equivalent) for framework, language version, test runner, linter
   - Check for common config files: `tsconfig.json`, `biome.json`, `.eslintrc`, `vitest.config.*`, `jest.config.*`

2. **File tree summary:**
   ```bash
   find . -maxdepth 2 -type f | head -60
   ```
   Summarize the directory structure at depth 2.

3. **Sacred files — identify files that must not be modified:**
   - Lock files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
   - Generated code: files in `dist/`, `build/`, `.next/`, `generated/`
   - Config files the user may have customized: `.env`, `*.config.*`
   - Record these for the quiz in Step 5.

---

### Step 2 — Adaptive Interview

Conduct a structured interview using `AskUserQuestion` for all prompts.

**If a captured project was selected in Step 0:**

1. Call `getProjectDetails(projectId)` to load the full project description
2. Call `getProjectIssues(projectId)` to load all captured issues
3. Store the issue IDs for later archival in Step 6
4. Use the project description as context — skip "What problem does this project solve?" and "What are the top 3 goals?"
5. Still ask "What is explicitly out of scope?"
6. Present captured issues as draft requirements:

<AskUserQuestion>
question: "Here are the issues from capture:
{for each issue: '- {title}: {description snippet}'}

Which should become requirements? Any to merge, split, or drop?"
options:
  - "Use all as-is — refine in sizing"
  - "I want to adjust — let me describe"
</AskUserQuestion>

7. Use the approved draft requirements as input to the "Converge on requirements" section — skip re-asking for behaviors that are already covered by captured issues

**If no captured project (standalone fallback):** Keep the current interview flow below.

**Project-level questions (always ask when no captured project):**

<AskUserQuestion>
question: "What problem does this project solve? Who are the primary users?"
</AskUserQuestion>

<AskUserQuestion>
question: "What are the top 3 goals for this project? What does 'done' look like?"
</AskUserQuestion>

<AskUserQuestion>
question: "What is explicitly out of scope? What should we NOT build?"
</AskUserQuestion>

**Branch based on project type:**

**Existing codebase — ask about:**
- Integration points: "Which existing modules will this feature interact with?"
- Migration concerns: "Are there database migrations, API versioning, or breaking changes to consider?"
- Backward compatibility: "What existing behavior must not change?"
- Existing patterns: "Which existing patterns or conventions should new code follow?"

**Greenfield — ask about:**
- Tech stack: "What language, framework, and key libraries?"
- Project structure: "Monorepo or single package? What directory layout?"
- Deployment target: "Where will this run? (Vercel, AWS, Docker, desktop, etc.)"
- Key libraries: "Any specific libraries or tools you want to use?"

**Converge on requirements:**

For each distinct user-facing behavior identified during the interview:

<AskUserQuestion>
question: "For '{behavior}': What are the acceptance criteria? What does the user see when it works?"
</AskUserQuestion>

Gather: acceptance criteria per behavior, estimated file scope, dependency relationships between behaviors.

**CRITICAL — Vertical Slice Enforcement:**

Every requirement MUST be a vertical slice — one user-facing behavior wired end-to-end across ALL layers.

Bad (horizontal layers):
- "Set up database schema"
- "Build API endpoints"
- "Create UI components"

Good (vertical slices):
- "User can log in with email/password"
- "User can view their dashboard"
- "User can update profile"

Acceptance criteria MUST be behavioral:
- Good: "User can log in with valid credentials and sees their dashboard"
- Bad: "POST /auth/login returns 200 with JWT token"

If you catch yourself writing a horizontal-layer requirement, stop and restructure it as a vertical slice that delivers end-to-end user value.

---

### Step 3 — Requirement Sizing Check

Before generating the graph, validate every requirement against the sizing rules in `ref/requirement-sizing.md`.

**Hard limits (automatic split required):**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Acceptance criteria | > 6 | Must split |
| Files (creates + modifies) | > 5 | Must split |
| Groups referenced | > 2 | Must split |

**Soft limits (warning):**

| Metric | Threshold | Warning |
|--------|-----------|---------|
| Acceptance criteria | > 4 | "Consider splitting" |
| Files touched | > 3 | "Consider splitting" |
| Multiple user behaviors in one criterion | Any | "This is 2+ requirements" |

**If any requirement exceeds a hard limit:**

Present the issue and a split proposal:

"{req-id} has {N} acceptance criteria and {M} files — that's too large for a single requirement. I'll split it into {K} vertical slices. Here's my proposal: [...]"

<AskUserQuestion>
question: "Does this split look right, or would you restructure differently?"
options:
  - "Looks good — apply the split"
  - "I'd restructure differently — let me explain"
</AskUserQuestion>

Apply the approved split. Re-check sizing on the resulting slices. Repeat until all requirements are within limits.

---

### Step 4 — Generate Graph

Write the graph files to `.planning/graph/{slug}/`:

1. **`_index.yaml`** — The graph manifest:
   - `slug`: project slug
   - `title`: project title
   - `groups`: ordered list of groups with optional dependency edges between them
   - `requirements`: list of requirement entries with:
     - `id`, `title`, `group`, `status: pending`, `dependsOn: []`
     - `files: { creates: [], modifies: [] }`
   - Run `detectCycles()` on the graph before writing. If cycles are found, resolve them before proceeding.

2. **`overview.md`** — Project overview synthesized from the interview:
   - Problem statement, goals, scope, users
   - Tech stack and conventions (from codebase scan if applicable)
   - Sacred files list
   - Out-of-scope items

3. **Individual requirement files** (`req-NNN.md`) — One per requirement:
   ```yaml
   ---
   id: req-001
   title: "User can log in with email/password"
   group: "Authentication"
   dependsOn: []
   files:
     creates:
       - src/api/login.ts
       - src/components/LoginForm.tsx
     modifies:
       - src/middleware/auth.ts
   acceptance:
     - "User submits login form with valid credentials and sees dashboard"
     - "Invalid credentials show error message"
     - "Session persists across page reloads"
   ---

   ## Context
   {Why this requirement exists, drawn from interview notes}

   ## Technical Approach
   {How to implement — key decisions, patterns to follow, integration points}

   ## Interview Notes
   {Relevant excerpts from the user's answers during the interview}
   ```

---

### Step 5 — Quiz and Iterate

Present the complete graph to the user for review.

Print the graph summary:

```
Here's the requirement graph for {project}:

Groups: {list with dependency order}

Requirements:
  {req-id}: {title} [depends on: {deps}]
  ...

Estimated waves: {output of computeWaves() preview}
```

Then ask review questions:

<AskUserQuestion>
question: "Review the requirement graph. Check these four areas:
1. Granularity — Any requirement too big or too small?
2. Dependencies — Anything that should depend on something else?
3. Missing slices — Any user-facing behavior not covered?
4. Sacred files — Anything I should not touch?"
options:
  - "Looks good — proceed to Linear sync"
  - "I have changes — let me describe them"
</AskUserQuestion>

**If the user has changes:**
- Apply their feedback (add/remove/split requirements, adjust dependencies, update files)
- Re-run sizing checks (Step 3) on modified requirements
- Re-run `detectCycles()` on the updated graph
- Re-present the graph (repeat Step 5)

**Iterate until the user approves.** Do not proceed until they select "Looks good."

---

### Step 6 — Linear Sync

Create the project, milestones, and issues in Linear.

1. **Load `.forge.json`** to get the `linearTeam` name.

2. **Create Linear project:**
   - Title: graph title from `_index.yaml`
   - Description: content from `overview.md`
   - State: **Planned**

3. **Create milestones** — one per group in the graph:
   - For each group in `_index.yaml`, call `ForgeLinearClient.createMilestone({ name: groupName, projectId })`
   - Store the returned `milestoneId` as `linearMilestoneId` in the group's entry in `_index.yaml`
   - Milestone progress auto-calculates in Linear based on child issue completion

4. **Create Linear issues** — one per requirement:
   - Title: requirement title
   - Description: requirement body (context + technical approach)
   - State: **Planned**
   - Labels: group name
   - `projectMilestoneId`: the group's `linearMilestoneId` from step 3

5. **Store Linear IDs** back into `_index.yaml`:
   - Project ID at the top level
   - Milestone IDs in each group entry (`linearMilestoneId`)
   - Issue ID in each requirement entry
   - Write via `writeIndex()`

5b. **Archive original capture issues:**
   - If the plan was created from a captured project, archive the original capture issues
   - Resolve the "cancelled" state: `resolveIssueStateByCategory(teamId, 'cancelled')`
   - Call `updateIssueBatch(captureIssueIds, { stateId: cancelledStateId })` to cancel all original issues
   - This replaces the rough capture issues with the properly structured requirement graph issues

6. **Transition project to Planned:**
   ```bash
   npx forge linear sync-planned --slug {slug}
   ```

7. **Commit the graph directory** to the current feature branch:

   ```bash
   git add .planning/graph/{slug}/
   git commit -m "plan: {slug} — requirement graph with {N} requirements in {M} groups

   Groups: {comma-separated group names}
   Requirements: {count}
   Waves: {count from computeWaves()}

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

---

### Step 7 — Summary

Print the final summary:

```
## Plan Complete: {project title}

**Slug:** {slug}
**Groups:** {count} ({comma-separated names})
**Requirements:** {count}
**Waves:** {count}
**Linear Project:** {project URL}

### Next Steps
1. Run `/forge:build {slug}` to start executing the graph
2. Or run `/forge:plan` again to refine before building
```

---

## Context Budget

Keep these limits to avoid context bloat during planning:

| Item | Budget |
|------|--------|
| Codebase scan | ~2K tokens |
| Interview transcript | Grows during conversation — summarize when long |
| Existing graph (if iterating) | Load via `loadIndex()` only — do not re-read files |

## Key References

- `ref/requirement-sizing.md` — Hard/soft limits and vertical slice splitting guide
- `ref/adversarial-review.md` — Review protocol used by `forge:build` (downstream consumer)
- `ref/graph-correction.md` — Mid-execution correction protocol (design graphs to minimize corrections)

## Graph Module API

These TypeScript functions are available for graph operations:

- `loadIndex(projectDir, slug)` — Load `_index.yaml` from `.planning/graph/{slug}/`
- `writeIndex(projectDir, slug, index)` — Write `_index.yaml`
- `findReady(index)` — Return requirement IDs with all deps complete
- `computeWaves(index)` — Group requirements into parallel execution waves
- `detectCycles(index)` — Check for circular dependencies
- `isProjectComplete(index)` — Check if all requirements are complete
- `buildRequirementContext(index, reqId)` — Return transitive deps in topological order
