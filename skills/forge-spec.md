# /forge:spec — Linear Project to PRD with Milestones

Turn a Linear project into a detailed PRD with milestones and issues. This skill scans the codebase, conducts an adaptive interview, generates a PRD, and syncs the plan back to Linear.

## Instructions

Follow these steps exactly. The interview is adaptive — lead with recommendations, not blank-slate questions.

### Step 1 — Select Linear Project

Fetch incomplete projects from Linear. First, resolve the team ID:

```bash
npx forge linear list-teams
```

This returns a JSON array of teams: `[{id, name, key}]`. If `linearTeam` is set in `.forge.json`, match by name or key. If there is only one team, use it automatically. If multiple and no config, ask the user which team.

Then fetch projects for that team:

```bash
npx forge linear list-projects --team <teamId>
```

This returns a JSON array of projects: `[{id, name, description, state}]`.

Filter to projects in "Backlog" state (these are triaged but not yet specced). Present them as a numbered list:

```
## Projects Ready for Spec

1. **Project Name** — description
2. **Project Name** — description
```

Then ask:

> Which project would you like to spec? Pick a number, or type a project name.

If no Backlog projects exist, say:

> No projects in Backlog state. Run `/forge:triage` first to create projects from your ideas, or create one directly in Linear.

Wait for the user's selection before continuing.

### Step 2 — Scan the Codebase

Run 3 parallel codebase scan agents using the Task tool (subagent_type: Explore):

**Agent 1 — Structure Scanner:**
```
Use Glob and Read tools to scan for: package.json, tsconfig.json, .env*, config files, key directories (src/, app/, pages/, lib/).
Report: framework, language, dependencies, project structure, build tools.
```

**Agent 2 — Routes/UI Scanner:**
```
Use Glob and Grep tools to scan for: route files, pages, layouts, navigation components, route definitions.
Look in common locations: src/app/, src/pages/, src/routes/, app/, pages/.
Grep for route patterns (e.g., "createBrowserRouter", "Route", "router.", "app.get", "app.post").
Report: routing framework, page count, API route count, layout structure.
```

**Agent 3 — Data/APIs Scanner:**
```
Use Glob and Grep tools to scan for: API endpoints, database files (schema.prisma, migrations/, models/), env files (.env*), external service configs, ORM setup, SDK clients.
Grep for patterns like "fetch(", "axios", "prisma.", "mongoose.", "createClient".
Report: database type, API patterns, external integrations, auth setup.
```

Combine the results into a plain-text summary. Print a brief overview:

```
## Codebase Scan Complete

- **Framework:** Next.js (TypeScript)
- **Pages:** 12 | **API Routes:** 8
- **Dependencies:** 24 | **DB Files:** 3
- **Key Files:** src/lib/auth.ts, src/db/schema.prisma, ...
```

If the current working directory does not look like a project (no package.json, no src/), warn:

> This directory doesn't look like a project root. Should I scan here, or provide a path to the project?

### Step 3 — LLM-Driven Adaptive Interview

You (the LLM) drive the interview directly. Track coverage mentally across the 5 sections. No TypeScript state tracking — you are the state tracker.

The interview covers 5 sections:

1. **Problem & Goals** — core problem, desired outcome, success criteria, impact/urgency, current workarounds, who feels the pain
2. **User Stories** — primary users, user workflows step-by-step, secondary users, edge cases, permissions/roles, error states
3. **Technical Approach** — architecture pattern, data model/schema, APIs/integrations, auth/security, performance requirements, error handling, existing code to leverage
4. **Scope** — in scope boundaries, out of scope, sacred files/areas, constraints, future phases explicitly deferred
5. **Milestones** — breakdown into chunks, dependencies between milestones, sizing (fits in one agent context?), verification criteria, delivery order, risk areas

**Interview Loop — You Drive:**

1. Start with a broad opening question for Problem & Goals, informed by scan results
2. After each answer:
   - Assess coverage gaps mentally (which topics are uncovered? which answers were vague?)
   - Generate the next question based on: scan results, all prior Q&A, what's still ambiguous
   - Probe deeper on vague or short answers — don't accept "TBD" or one-liners for important topics
   - Move to the next section when the current one has thorough coverage
   - Revisit earlier sections if later answers reveal new info
3. Continue until all 5 sections have adequate coverage

**Question Principles — Encode These:**

- Ask about edge cases, error states, and "what could go wrong"
- When the user mentions an integration, ask about auth, rate limits, failure modes
- When the user describes a workflow, walk through it step-by-step
- For milestones, actively challenge sizing — "is this too big for one context window?"
- Don't ask yes/no questions — ask "how" and "what" questions that elicit detail
- Circle back to earlier sections when new info surfaces
- Follow interesting threads: if the user mentions migration, breaking changes, multiple user types, or external services, dig deeper

**Stop Condition:**

You determine you have enough detail for a thorough PRD across ALL sections, with no significant ambiguity remaining. Before transitioning to Step 4, print a coverage summary showing the final state of each section.

**Early Exit:**

If the user says "stop", "that's enough", "skip", or "generate it" at any time, respect that and move to Step 4 with what you have.

**Milestone Sizing Constraint (Hard Rule):**

Each milestone MUST be completable in one main agent context window. If a milestone requires more than ~4 agents across 2-3 waves, split it. This is non-negotiable — large milestones cause context overflow and execution failures. When interviewing about milestones, actively recommend splitting any milestone that looks too large.

**Milestone Dependencies (dependsOn):**

During the milestones phase of the interview, ask about milestone dependencies using AskUserQuestion. For each milestone after the first, ask:

- question: "Does Milestone {N} depend on any previous milestones?"
- options:
  - "No dependencies — can start immediately"
  - "Depends on Milestone {N-1} (sequential)"
  - "Depends on specific milestones (I'll specify)"

If milestones have explicit dependencies, include `**dependsOn:** 1, 2` in the milestone section of the PRD. If no dependencies are specified, omit the field (backward compatible — treated as sequential).

Independent milestones enable parallel execution via `/forge:go`, which creates separate worktrees for each parallel milestone.

**Question Format:**

Mix AskUserQuestion (for structured choices) and conversational questions (for open-ended probing):

- **Use AskUserQuestion** when there are clear option sets (architecture choices, yes/no with detail, picking from scan-derived options). Provide 2-4 options plus "Other (I'll describe)".
- **Use conversational questions** when probing for depth, asking "how" or "what" questions, or exploring topics that don't have predefined options.
- **NEVER present questions as numbered text lists.** Each structured question gets its own AskUserQuestion call.
- **Lead with recommendations.** Every question includes context from the codebase scan. Never ask a blank "what do you want to build?" question.

**Progress Display:**

After each answer, show a compact coverage status:

```
Progress: Problem & Goals [thorough] | User Stories [moderate] | Technical [thin] | Scope [none] | Milestones [none]
```

**Draft Updates:**

- **Update the PRD draft every 2-3 answers.** Write to `.planning/prds/{project-slug}.md`. Tell the user:

> Updated PRD draft at `.planning/prds/{slug}.md` — you can review it anytime.

**Do NOT do this (anti-pattern):**

```
### Round N

1. **[Section]** Question text?
2. **[Section]** Question text?

> Answer by number...
```

This numbered-text format is explicitly prohibited. Always use AskUserQuestion for structured choices.

### Step 4 — Generate PRD

Using all gathered interview answers and codebase scan results, generate the final PRD directly. The LLM synthesizes all interview data into the PRD — no external generator module needed.

The PRD should follow this structure:

```markdown
# PRD: {Project Name}

## Problem & Goals
{Synthesized from interview answers}

## User Stories
{Structured user stories derived from interview}

## Technical Approach
{Stack decisions, architecture, constraints — informed by codebase scan}

## Scope
### In Scope
{What will be built}

### Out of Scope
{Explicitly excluded items}

### Sacred Files
{Files/areas not to be touched}

## Milestones

### Milestone 1: {Name}
**Goal:** {What this delivers}
**Issues:**
- [ ] Issue title — brief description
- [ ] Issue title — brief description

### Milestone 2: {Name}
**dependsOn:** 1
**Goal:** {What this delivers}
...
```

**Milestone sizing check:** Before finalizing, review each milestone against the sizing constraint. Every milestone MUST fit in one agent context window (~4 agents across 2-3 waves max). If any milestone exceeds this, split it into smaller milestones before writing the final PRD. Set `maxContextWindowFit: true` on all milestones — if you cannot make a milestone fit, flag it as `maxContextWindowFit: false` and warn the user.

**Test criteria guidance:** Test criteria are optional. Only include them when the milestone produces testable behavior. Verification commands (`npx tsc --noEmit`, `npx forge verify`) are always included automatically — test criteria are for additional functional checks beyond mechanical gates. When including test criteria, make them **functional**, not structural:
- Good: "CLI `npx forge verify` runs and exits 0", "tsc compiles with no errors", "the new gate produces structured JSON output"
- Bad: "All new source files must have corresponding test files", "Run npx forge verify --gate tests"

Write the final PRD to `.planning/prds/{project-slug}.md`.

After writing the PRD file, **execute BOTH steps below — do not skip either**:

1. **Create status file:** Write `.planning/status/<slug>.json` with all milestones set to "pending". **You MUST include `linearProjectId` and `linearTeamId`** — these are the Linear project UUID and team UUID from the project selected in Step 1. Without `linearProjectId`, `/forge:go` cannot sync Linear issue or project state and will silently skip all Linear operations. Without `linearTeamId`, the forge Linear sync commands (`sync-start`, `sync-complete`, `sync-done`) silently skip all operations. Copy the exact IDs — do not omit these fields:
   ```json
   {
     "project": "{project name}",
     "slug": "{slug}",
     "branch": "feat/{slug}",
     "createdAt": "{today}",
     "linearProjectId": "{Linear project UUID from Step 1}",
     "linearTeamId": "{team UUID — resolved in Step 5, but placeholder here}",
     "milestones": {
       "1": { "status": "pending" },
       "2": { "status": "pending" }
     }
   }
   ```

2. **Create feature branch:** `git checkout -b feat/{slug}`

Tell the user:

> Final PRD written to `.planning/prds/{slug}.md`.
> Status file created at `.planning/status/{slug}.json`.
> Feature branch `feat/{slug}` created.

Present the full PRD in chat for review and ask:

> Review the PRD above. You can:
> - **Approve** — I'll create milestones and issues in Linear
> - **Edit** — tell me what to change (e.g., "add a milestone for testing" or "remove the admin user story")
> - **Regenerate** — start the interview over
>
> What would you like to do?

Wait for approval before continuing to Step 5.

### Step 5 — Sync to Linear

After the user approves the PRD, create milestones and issues in Linear using forge CLI commands.

**All CLI commands output JSON to stdout.** Parse the JSON output to extract IDs for subsequent commands.

First, get the team ID (if not already resolved in Step 1):

```bash
npx forge linear list-teams
```

This returns `[{id, name, key}]`. If there is only one team, use it automatically. If multiple, ask the user which team.

**Store the team ID** — it will be written to the status file after sync.

**Create milestones.** For each milestone in the PRD:

```bash
npx forge linear create-milestone --project <projectId> --name "<milestone name>" --description "<milestone goal>"
```

This returns `{id}`. **Record the returned milestone ID** for each milestone.

**Create issues.** For each milestone, use batch creation to create all issues at once:

```bash
npx forge linear create-issue-batch --team <teamId> --project <projectId> --milestone <milestoneId> --issues '[{"title": "Issue title", "description": "Issue description", "priority": 2}, {"title": "Another issue", "description": "Description", "priority": 2}]'
```

This returns `{ids: [...], identifiers: [...]}`. **Record the returned issue IDs** for each milestone.

If batch creation fails (e.g., due to shell quoting issues), fall back to individual issue creation:

```bash
npx forge linear create-issue --team <teamId> --title "<title>" --project <projectId> --milestone <milestoneId> --description "<description>" --priority 2
```

This returns `{id, identifier}`.

**Create issue relations for milestone dependencies.** After all milestones and issues are created, if milestones have `dependsOn` relationships in the PRD, create blocking relations between issues. For each dependency (e.g., Milestone 2 depends on Milestone 1), create a relation from an issue in the blocking milestone to an issue in the dependent milestone:

```bash
npx forge linear create-issue-relation --issue <blockingIssueId> --related-issue <dependentIssueId> --type blocks
```

This returns `{id}`. Use the first issue ID from each milestone as the representative for the relation. This connects milestones in Linear's dependency graph so the team can visualize the execution order.

**After all milestones, issues, and relations are created, do TWO things:**

1. **Update the status file** at `.planning/status/<slug>.json` with the Linear IDs:

```json
{
  "project": "{project name}",
  "slug": "{slug}",
  "branch": "feat/{slug}",
  "createdAt": "{today}",
  "linearProjectId": "{Linear project UUID from Step 1}",
  "linearTeamId": "{team UUID from this step}",
  "milestones": {
    "1": { "status": "pending", "linearIssueIds": ["{id1}", "{id2}"] },
    "2": { "status": "pending", "linearIssueIds": ["{id1}", "{id2}"] }
  }
}
```

**`linearTeamId` is MANDATORY.** Without it, the forge Linear sync commands (`sync-start`, `sync-complete`, `sync-done`) silently skip all operations. **`linearIssueIds` per milestone are MANDATORY.** These enable `/forge:go` to transition issues as milestones are completed.

**Promote project to Planned:** After updating the status file, transition the project from Backlog to Planned in Linear:

```bash
npx forge linear sync-planned --slug {slug}
```

This is a promote-only transition — if the project is already at "Planned" or higher, it's a no-op.

2. **Print a summary:**

```
## Synced to Linear

- **Project:** {name}
- **Milestones:** {N} created
- **Issues:** {M} created across all milestones
- **Relations:** {R} dependency relations created

Note: Project transitioned to "Planned". It will move to "In Progress" when `/forge:go` runs.
```

If any creation fails, report the error and continue with remaining items.

### Step 6 — Handoff

After sync, print the handoff prompt:

```
## Ready for Development

PRD: `.planning/prds/{slug}.md`
Status: `.planning/status/{slug}.json`
Branch: `feat/{slug}`
Linear: {project URL}

**Next step:** Run `/forge:go` for one milestone at a time, or exit and run `npx forge run` to execute all milestones autonomously. The execution engine will:
- Read the PRD and per-PRD status file
- Spawn agent teams for each milestone
- Verify each change with forge verification gates
- Update status JSON and transition Linear issues automatically
```

**Note:** `/forge:go` now uses git worktrees for session isolation. Multiple users can run `/forge:go` on different milestones simultaneously without conflicts.

## Edge Cases

- **No Linear connection:** If `LINEAR_API_KEY` is not set or forge CLI commands fail with auth errors, warn the user. Still generate the PRD locally — skip the Linear sync steps.
- **Empty codebase:** The interview still works — questions will be more open-ended without scan context. Note this to the user.
- **User wants to spec a project not in Linear:** Allow it. Skip Step 1 project selection, ask for a project name, and create the Linear project in Step 5 before creating milestones.
- **User provides info upfront:** If the user includes project details in the same message as `/forge:spec`, use that info to pre-fill interview answers and skip questions that are already answered.
- **Very large codebase:** Scan agents may return truncated results. That's fine — the interview fills in gaps.
- **Interrupted interview:** If the user stops mid-interview, save what you have to the PRD draft. They can resume by running `/forge:spec` again and selecting the same project.
