# /forge:triage — Brain Dump to Linear Projects

Turn sticky notes, rambling thoughts, and unstructured ideas into organized Linear projects. Paste anything — bullet points, paragraphs, stream of consciousness — and this skill extracts distinct projects, deduplicates against your existing Linear backlog, and creates them after your confirmation.

**This skill uses `npx forge linear` CLI commands** for all Linear operations. No MCP tools are required — the forge CLI handles authentication via `LINEAR_API_KEY` in your environment.

## Prerequisites

This skill requires **forge CLI** with Linear integration configured. You need:

- `LINEAR_API_KEY` set in your environment (or in `.env`)
- `forge-cc` installed (`npx forge linear list-teams` should return your teams)

## Instructions

Follow these steps exactly. Do not skip confirmation.

### Step 0 — Resolve Team Configuration

Read `.forge.json` from the project root. Check for the `linearTeam` field:

- **If `linearTeam` is set** (non-empty string): store it as the configured team name/key. This will be used to auto-resolve the team ID in Step 5 and to scope project listing in Step 3. Note: CLI commands require a team ID (UUID), so the name/key will be resolved to an ID via `npx forge linear list-teams`.
- **If `linearTeam` is empty or `.forge.json` does not exist**: no team is pre-configured. The skill will prompt for team selection in Step 5 if needed.

This check is silent — do not print output unless there is an error reading the config.

### Step 1 — Collect Input

If the user has already provided text (ideas, notes, brain dump) in the same message as invoking this skill, use that as input. Otherwise, prompt:

> Paste your ideas, sticky notes, or brain dump below. Any format works — bullet points, paragraphs, stream of consciousness. I'll extract the projects from whatever you give me.

Wait for the user's input before continuing. Do not proceed with an empty input.

If the input is extremely short or vague (fewer than 5 words with no actionable idea), ask:

> That's a bit thin. Can you expand on what you're thinking? Even a sentence or two per idea helps me create better project descriptions.

### Step 2 — Extract Projects

Parse the input to identify distinct project ideas. For each idea, determine:

- **Name**: Short, descriptive project name (2-5 words, title case)
- **Description**: 1-2 sentence summary capturing the core intent
- **Priority**: High / Medium / Low based on urgency signals in the text (words like "urgent", "ASAP", "critical", "soon" = High; "eventually", "someday", "nice to have" = Low; everything else = Medium)
- **Dependencies**: If the user mentions that one idea blocks or depends on another, note the relationship (e.g., "Project A blocks Project B")

Rules for extraction:
- Group related ideas into a single project. If someone mentions "mobile app redesign" and "fix the mobile nav", that is one project, not two.
- If an idea is extremely vague (e.g., "maybe something with AI"), still extract it but flag it for clarification in Step 4.
- For a single idea, create one project. For 10+ ideas, create as many projects as are genuinely distinct — do not artificially limit or pad.
- Do not invent projects that were not in the input. Only extract what is there.

### Step 3 — Deduplicate Against Linear

First, resolve the team ID if `linearTeam` was configured in Step 0:

```bash
npx forge linear list-teams
```

This returns a JSON array of teams `[{id, name, key}]`. Match the configured `linearTeam` value against the returned teams by name or key to get the team ID.

Then fetch existing projects scoped to that team:

```bash
npx forge linear list-projects --team <teamId>
```

This returns a JSON array of projects `[{id, name, description, state}]`.

For each extracted project, compare its name and description against existing projects. A project is a potential duplicate if:
- The name is very similar (e.g., "Mobile Redesign" vs "Mobile App Redesign")
- The description covers the same scope

Mark duplicates with status `DUPLICATE` and reference the existing project name. Mark new projects with status `NEW`.

If the CLI command fails (auth issue, LINEAR_API_KEY not set, forge CLI not available), warn the user:

> Could not connect to Linear to check for duplicates. Make sure `LINEAR_API_KEY` is set in your environment and `npx forge linear list-teams` works. I'll proceed without dedup — you can review for duplicates manually.

Then skip dedup and mark all projects as `NEW`.

### Step 4 — Present for Confirmation

Show the user a formatted list:

```
## Extracted Projects (N total)

1. **Project Name** — Description
   Priority: High | Status: NEW

2. **Project Name** — Description
   Priority: Medium | Status: DUPLICATE of "Existing Project Name"

3. **Project Name** — Description
   Priority: Low | Status: NEW | NOTE: This idea was vague — confirm or clarify?
```

If any dependencies were identified in Step 2, show them below the list:

```
## Dependencies
- "Project A" blocks "Project B"
```

Then ask:

> Review the list above. You can:
> - **Confirm all** — I'll create the NEW ones in Linear
> - **Remove items** — tell me which numbers to skip (e.g., "remove 2, 5")
> - **Edit items** — tell me what to change (e.g., "rename 3 to X" or "change 1 priority to Low")
> - **Clarify** — expand on any flagged vague ideas
>
> What would you like to do?

Wait for the user's response. Apply any edits, removals, or clarifications. If the user says "confirm" or similar affirmative, proceed to Step 5. If they make changes, show the updated list and confirm again.

### Step 5 — Create in Linear

**Resolve the team:**

If the team ID was already resolved in Step 3, reuse it. Otherwise, run:

```bash
npx forge linear list-teams
```

This returns a JSON array of teams `[{id, name, key}]`.

If `linearTeam` was set in Step 0, match the configured value against the returned teams by key or name. If a match is found, use that team's `id` automatically. If no match is found, warn:

> The configured team "{linearTeam}" was not found in Linear. Available teams are listed below — pick one, or update `linearTeam` in `.forge.json`.

Then present the available teams for selection.

If `linearTeam` was NOT configured in Step 0: if there is only one team, use it automatically. If there are multiple teams, ask the user which team to use.

**Create projects:**

For each confirmed NEW project (skip items marked DUPLICATE that the user did not override):

```bash
npx forge linear create-project --name "Project Name" --team <teamId> --description "Project description" --priority <0-4>
```

Map extracted priorities to numeric values: High = 1 (Urgent), Medium = 2 (High), Low = 3 (Medium). Omit `--priority` to use Linear's default.

This returns `{id, url}`. Store the returned `id` for each created project — it is needed for creating project relations.

If a project creation fails, report the error and continue with the remaining projects. Do not abort the entire batch for a single failure.

**Create project relations:**

After all projects are created, if dependencies were identified in Step 2 and the related projects were both successfully created, create the relationships:

```bash
npx forge linear create-project-relation --project <blockingProjectId> --related-project <blockedProjectId> --type blocks
```

This returns `{id}`. If a relation creation fails, report the error but do not fail the entire batch.

If ALL project creations fail (e.g., auth expired, LINEAR_API_KEY invalid), print:

> Linear project creation failed. Check that `LINEAR_API_KEY` is set and valid in your environment. You can create these projects manually in Linear:
>
> {list each project name and description}

After all projects (and relations) are created, print a summary:

```
## Created N projects in Linear

- **Project Name** — created successfully
- **Project Name** — created successfully
- **Project Name** — FAILED: [error message]

Skipped M duplicates.

## Relations Created
- "Project A" blocks "Project B" — created successfully
```

### Step 6 — Suggest Next Steps

After creation, print:

> **Next steps:**
> - Run `/forge:spec` on any of these projects to create a detailed PRD with milestones
> - Run `/forge:triage` again to add more ideas
> - Open Linear to review and organize your new projects

## Edge Cases

- **Empty input**: Prompt the user to provide input. Do not create empty projects.
- **Single idea**: Create one project. The workflow still applies (confirm before creating).
- **10+ ideas**: Process all of them. Group aggressively to avoid near-duplicates.
- **All duplicates**: Report that all ideas already exist in Linear. Suggest reviewing existing projects.
- **Linear CLI not configured**: Warn the user with setup instructions at the first point of failure (Step 3 or Step 5). Mention checking `LINEAR_API_KEY` and running `npx forge linear list-teams` to verify. Still extract and present projects — the user can create them manually.
- **Linear auth fails mid-flow**: If dedup succeeds (Step 3) but creation fails (Step 5), print the project list in a copy-friendly format so the user can create them manually.
- **Vague ideas**: Extract them with a clarification flag. Let the user decide whether to keep, clarify, or remove.
- **Multiple teams with no config**: If `linearTeam` is not set in `.forge.json` and multiple teams exist, present a team picker. Suggest the user run `/forge:setup` or set `linearTeam` in `.forge.json` for future runs.
