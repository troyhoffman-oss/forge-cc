# /forge:spec — Linear Project to PRD with Milestones

Turn a Linear project into a detailed PRD with milestones and issues. This skill scans the codebase, conducts an adaptive interview, generates a PRD, and syncs the plan back to Linear.

## Instructions

Follow these steps exactly. The interview is adaptive — lead with recommendations, not blank-slate questions.

### Step 1 — Select Linear Project

Fetch incomplete projects from Linear:

```
Use mcp__linear__list_projects to get all existing projects.
```

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

Run 3 parallel codebase scan agents using the Task tool. Each agent should use the scanner module at `src/spec/scanners.ts`:

**Agent 1 — Structure Scanner:**
```
Scan the project directory for framework, language, config files, dependencies, and key files.
Use the scanStructure() function from the scanner module.
Report the StructureScanResult.
```

**Agent 2 — Routes/UI Scanner:**
```
Scan for route files, pages, API routes, layouts, and routing framework.
Use the scanRoutes() function from the scanner module.
Report the RoutesScanResult.
```

**Agent 3 — Data/APIs Scanner:**
```
Scan for API endpoints, database files, env files, external services, and schema files.
Use the scanDataAPIs() function from the scanner module.
Report the DataAPIsScanResult.
```

Combine the results into a `ScanAllResult`. Print a brief summary:

```
## Codebase Scan Complete

- **Framework:** Next.js (TypeScript)
- **Pages:** 12 | **API Routes:** 8
- **Dependencies:** 24 | **DB Files:** 3
- **Key Files:** src/lib/auth.ts, src/db/schema.prisma, ...
```

If the current working directory does not look like a project (no package.json, no src/), warn:

> This directory doesn't look like a project root. Should I scan here, or provide a path to the project?

### Step 3 — Adaptive Interview

Conduct an adaptive interview using the interview engine logic from `src/spec/interview.ts`. The interview covers 5 sections in priority order:

1. **Problem & Goals** — what problem, desired outcome, success criteria
2. **User Stories** — primary users, workflows, secondary users
3. **Technical Approach** — architecture decisions, constraints, stack
4. **Scope** — what's out, sacred files, boundaries
5. **Milestones** — phasing, dependencies, delivery chunks

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

**Interview Rules:**

- **NEVER present questions as numbered text — always use AskUserQuestion with 2-4 options per question.** Every interview question MUST be delivered via Claude Code's AskUserQuestion tool with structured multiple-choice options. Do not print numbered lists of questions for the user to answer in free text.
- **Lead with recommendations.** Every question includes context from the codebase scan as the question text. Never ask a blank "what do you want to build?" question.
- **Ask 1 question at a time via AskUserQuestion.** Each question gets its own AskUserQuestion call with 2-4 predefined options derived from codebase scan context and common patterns. Always include a final option like "Other (I'll describe)" to allow the user to provide a custom answer.
- **Follow interesting threads.** If the user's selection mentions migration, breaking changes, multiple user types, or external integrations, follow up with targeted AskUserQuestion calls.
- **Show progress.** After each answer round, show a compact status as text output:

```
Progress: [##---] Problem & Goals (2/2) | User Stories (0/2) | Technical (0/1) | Scope (0/1) | Milestones (0/1)
```

- **Update the PRD draft every 2-3 answers.** Write the current draft to `.planning/prds/{project-slug}.md`. Tell the user:

> Updated PRD draft at `.planning/prds/{slug}.md` — you can review it anytime.

- **Stop when complete.** When all sections have enough info (Problem 2+, Users 2+, Technical 1+, Scope 1+, Milestones 1+), move to Step 4. Don't drag the interview out.
- **Allow early exit.** If the user says "that's enough", "skip", or "generate it", respect that and move to Step 4 with what you have.

**Question Format (AskUserQuestion):**

Each interview question MUST use AskUserQuestion. Build the question text from codebase scan context and the section being asked about. Provide 2-4 options that reflect likely answers based on the scan results, plus a free-text escape hatch. Example:

```
AskUserQuestion:
  question: "[Section] Context from scan or previous answers. Question text here?"
  options:
    - "Option A — a likely answer based on scan findings"
    - "Option B — another plausible direction"
    - "Option C — a third possibility (if applicable)"
    - "Other (I'll describe)"
```

If the user selects "Other (I'll describe)", prompt them for a free-text answer using a follow-up AskUserQuestion or accept their typed response.

**Do NOT do this (anti-pattern):**

```
### Round N

1. **[Section]** Question text?
2. **[Section]** Question text?

> Answer by number...
```

This numbered-text format is explicitly prohibited. Always use AskUserQuestion.

### Step 4 — Generate PRD

Using all gathered interview answers and codebase scan results, generate the final PRD. Use the generator module at `src/spec/generator.ts`:

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

Write the final PRD to `.planning/prds/{project-slug}.md`. Tell the user:

> Final PRD written to `.planning/prds/{slug}.md`.

Present the full PRD in chat for review and ask:

> Review the PRD above. You can:
> - **Approve** — I'll create milestones and issues in Linear
> - **Edit** — tell me what to change (e.g., "add a milestone for testing" or "remove the admin user story")
> - **Regenerate** — start the interview over
>
> What would you like to do?

Wait for approval before continuing to Step 5.

### Step 5 — Sync to Linear

After the user approves the PRD, create milestones and issues in Linear.

First, get the team ID:

```
Use mcp__linear__list_teams to get available teams.
```

If there is only one team, use it automatically. If multiple, ask the user which team.

For each milestone in the PRD:

```
Use mcp__linear__create_milestone with:
  - projectId: the selected project's ID
  - name: milestone name
  - description: milestone goal
```

For each issue under that milestone:

```
Use mcp__linear__create_issue with:
  - title: issue title
  - description: issue description (from PRD)
  - teamId: the team ID
  - projectId: the project ID
  - milestoneId: the milestone ID just created
```

After all milestones and issues are created, transition the project to "Planned":

```
Use mcp__linear__update_project to set the project state to "planned".
```

Print a summary:

```
## Synced to Linear

- **Project:** {name} (now "Planned")
- **Milestones:** {N} created
- **Issues:** {M} created across all milestones

View in Linear: {project URL}
```

If any creation fails, report the error and continue with remaining items.

### Step 6 — Handoff

After sync, print the handoff prompt:

```
## Ready for Development

PRD: `.planning/prds/{slug}.md`
Linear: {project URL}

**Next step:** Run `/forge:go` to start executing Milestone 1. The execution engine will:
- Read the PRD and milestone plan
- Spawn agent teams for each issue
- Verify each change with forge-mcp gates
- Open PRs and transition issues automatically
```

**Note:** `/forge:go` now uses git worktrees for session isolation. Multiple users can run `/forge:go` on different milestones simultaneously without conflicts.

## Edge Cases

- **No Linear connection:** Warn the user. Still generate the PRD locally — skip the Linear sync steps.
- **Empty codebase:** The interview still works — questions will be more open-ended without scan context. Note this to the user.
- **User wants to spec a project not in Linear:** Allow it. Skip Step 1 project selection, ask for a project name, and create the Linear project in Step 5 before creating milestones.
- **User provides info upfront:** If the user includes project details in the same message as `/forge:spec`, use that info to pre-fill interview answers and skip questions that are already answered.
- **Very large codebase:** Scan agents may return truncated results. That's fine — the interview fills in gaps.
- **Interrupted interview:** If the user stops mid-interview, save what you have to the PRD draft. They can resume by running `/forge:spec` again and selecting the same project.
