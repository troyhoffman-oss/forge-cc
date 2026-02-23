# /forge:capture — Brain Dump to Linear Projects

Convert unstructured text (Slack threads, meeting notes, ideas) into Linear projects and optionally issues. Fast capture — no interview, no requirement graphs.

Replaces `/forge:triage`.

## Prerequisites

- `LINEAR_API_KEY` set in environment
- `.forge.json` with `linearTeam` configured
- `ForgeLinearClient` available from `forge-cc`

## Instructions

Follow these steps exactly. Do not skip confirmations.

---

### Step 1 — Collect Brain Dump

Ask the user for their unstructured input:

<AskUserQuestion>
question: "Paste your brain dump below — meeting notes, Slack threads, feature ideas, anything. I'll extract projects from it."
</AskUserQuestion>

Accept whatever the user provides. Do not ask follow-up questions about the content — capture is fast. Store the full text as the brain dump.

---

### Step 2 — Initialize Linear Client

Load the forge config and connect to Linear:

```
1. Read `.forge.json` to get `linearTeam`
2. Resolve the team ID using ForgeLinearClient
3. Fetch existing projects via `client.listProjects(teamId)` for dedup
```

If `LINEAR_API_KEY` is not set or the team cannot be resolved, stop and tell the user what's missing.

---

### Step 3 — Extract Projects

Parse the brain dump into candidate projects. For each project, extract:

- **Name:** Short, descriptive project name
- **Description:** 2-3 sentence summary of what the project involves
- **Priority:** P0 (critical), P1 (important), or P2 (nice-to-have)

Rules for extraction:
- Group related items into a single project rather than creating one project per bullet point
- A project should represent a meaningful body of work, not a single task
- If the brain dump mentions something that clearly maps to an existing Linear project (by name match), flag it as a duplicate and exclude it from the new project list
- Compare candidate names against the existing projects fetched in Step 2

---

### Step 4 — Present and Confirm

Show the extracted projects and ask the user to confirm:

<AskUserQuestion>
question: "I extracted {N} projects from your brain dump. Review:"
header: "Extracted Projects"
options:
  - "Create all"
  - "Edit list — I want to add, remove, or modify some"
  - "Cancel"
</AskUserQuestion>

Display each project as:

```
**{priority}** {name}
{description}
```

If duplicates were detected, list them separately:
```
Skipped (already exists in Linear):
- {existing project name}
```

**If "Edit list":** Ask the user what changes they want. Apply edits, then re-present the updated list for confirmation. Repeat until the user selects "Create all" or "Cancel".

**If "Cancel":** Stop. Print "Capture cancelled. No projects created."

---

### Step 5 — Optional Issue Extraction

After project confirmation, offer to extract issues:

<AskUserQuestion>
question: "Want me to also create initial issues for these projects?"
options:
  - "Yes — extract issues from the brain dump (recommended)"
  - "No — just create the projects"
</AskUserQuestion>

**If "Yes":**
1. Re-scan the brain dump for actionable items, tasks, and to-dos
2. Assign each item to the most relevant project from the confirmed list
3. For each issue: extract a title and optional 1-2 sentence description
4. Present issues grouped by project:

```
**{Project Name}** ({N} issues)
  - {issue title}
  - {issue title}
  ...
```

<AskUserQuestion>
question: "Here are the issues I extracted, grouped by project. Look good?"
options:
  - "Create all"
  - "Edit issues"
  - "Skip issues — just create projects"
</AskUserQuestion>

**If "Edit issues":** Apply user's edits, re-present, repeat until confirmed or skipped.

---

### Step 6 — Create in Linear

Create all confirmed items:

**Projects:**
For each confirmed project, call `client.createProject()`. It returns `LinearResult<{ id, url }>` — check `.success` and use `.data.id` for the project ID. The method deduplicates by name automatically.
```
const result = await client.createProject({
  name: "{project name}",
  description: "{project description}",
  teamIds: [teamId]
});
// result.success, result.data.id, result.data.url
```

Track `result.data.id` for each project — needed for issue creation.

**Issues (if requested):**
For each project's issues, call `client.createIssueBatch()` with an array (not wrapped in an object). It returns `LinearResult<{ ids, identifiers }>`.
```
const result = await client.createIssueBatch([
  {
    title: "{issue title}",
    description: "{issue description}",
    teamId: teamId,
    projectId: "{project's Linear ID}",
    stateId: "{Backlog state ID}"
  }
]);
// result.success, result.data.ids, result.data.identifiers
```

To get the "Backlog" state ID, look up the team's workflow states and find the one with category "backlog". If not found, fall back to "Triage".

**Error handling:**
- If a project creation fails, report it but continue with remaining projects
- If issue batch creation fails for a project, report it but continue with other projects
- Never silently skip failures — always print what failed and why

---

### Step 7 — Report

Print a summary of everything created:

```
## Capture Complete

**Projects created:** {N}
{for each project:}
- {name} ({priority}) — {Linear project URL}

{if issues were created:}
**Issues created:** {M}
{for each project with issues:}
- {project name}: {count} issues

**Linear state:** All projects and issues created at "Backlog"
```

If any items failed, include a failures section:
```
**Failed:**
- {item name}: {error reason}
```

---

## Linear State Reference

| Item    | Created State |
|---------|--------------|
| Project | Backlog      |
| Issue   | Backlog      |

Everything starts at "Backlog" — captured ideas haven't been planned yet. The plan skill transitions to "Planned" when requirements are defined.
