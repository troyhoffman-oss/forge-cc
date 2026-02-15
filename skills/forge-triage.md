# /forge:triage — Brain Dump to Linear Projects

Turn sticky notes, rambling thoughts, and unstructured ideas into organized Linear projects. Paste anything — bullet points, paragraphs, stream of consciousness — and this skill extracts distinct projects, deduplicates against your existing Linear backlog, and creates them after your confirmation.

## Instructions

Follow these steps exactly. Do not skip confirmation.

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

Rules for extraction:
- Group related ideas into a single project. If someone mentions "mobile app redesign" and "fix the mobile nav", that is one project, not two.
- If an idea is extremely vague (e.g., "maybe something with AI"), still extract it but flag it for clarification in Step 4.
- For a single idea, create one project. For 10+ ideas, create as many projects as are genuinely distinct — do not artificially limit or pad.
- Do not invent projects that were not in the input. Only extract what is there.

### Step 3 — Deduplicate Against Linear

Fetch existing projects from Linear:

```
Use mcp__linear__list_projects to get all existing projects.
```

For each extracted project, compare its name and description against existing projects. A project is a potential duplicate if:
- The name is very similar (e.g., "Mobile Redesign" vs "Mobile App Redesign")
- The description covers the same scope

Mark duplicates with status `DUPLICATE` and reference the existing project name. Mark new projects with status `NEW`.

If `mcp__linear__list_projects` fails (auth issue, Linear not configured), warn the user:

> Could not connect to Linear to check for duplicates. Make sure your Linear MCP tools are configured. I'll proceed without dedup — you can review for duplicates manually.

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

First, get the team ID (you only need to do this once):

```
Use mcp__linear__list_teams to get available teams.
```

If there is only one team, use it automatically. If there are multiple teams, ask the user which team to use.

For each confirmed NEW project (skip items marked DUPLICATE that the user did not override):

```
Use mcp__linear__create_project with:
  - name: the project name
  - description: the project description
  - state: "backlog"
```

If a project creation fails, report the error and continue with the remaining projects. Do not abort the entire batch for a single failure.

After all projects are created, print a summary:

```
## Created N projects in Linear

- **Project Name** — created successfully
- **Project Name** — created successfully
- **Project Name** — FAILED: [error message]

Skipped M duplicates.
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
- **Linear auth fails**: Warn the user, skip dedup, but still attempt creation. If creation also fails, provide manual instructions.
- **Vague ideas**: Extract them with a clarification flag. Let the user decide whether to keep, clarify, or remove.
