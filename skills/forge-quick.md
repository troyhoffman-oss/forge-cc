# /forge:quick — Ad-Hoc Tasks

Handle ad-hoc tasks without planning ceremony. No graph, no requirements, no adversarial review — direct build and verify with optional Linear tracking.

## Prerequisites

- Project has a working `npm run build` or equivalent
- Verification gates configured in `.forge.json` (types, lint, tests)

## Instructions

Follow these steps exactly. Do not skip confirmations.

---

### Step 1 — Collect Task

<AskUserQuestion>
question: "What do you need done? (one sentence)"
</AskUserQuestion>

Store the response as the task description. This becomes the commit message and (optionally) the Linear issue title.

---

### Step 2 — Optional Linear Integration

<AskUserQuestion>
question: "Track this in Linear?"
options:
  - "Yes — create an issue (recommended for non-trivial work)"
  - "No — just do it"
</AskUserQuestion>

**If "Yes":**

1. Read `.forge.json` to get `linearTeam`. If not configured:

<AskUserQuestion>
question: "Which Linear team should this issue belong to?"
</AskUserQuestion>

2. Create a Linear issue:
```
{
  title: "{task description}",
  teamId: teamId,
  stateId: "{Planned state ID}"
}
```

3. Immediately transition the issue to **In Progress** — work starts now.

4. Print the issue URL and identifier.

**If "No":** Continue without Linear tracking.

---

### Step 3 — Create Branch

Determine branch prefix from the task description:
- Bug fixes, corrections, error handling: `fix/quick-{timestamp}`
- Features, additions, improvements: `feat/quick-{timestamp}`

Where `{timestamp}` is `YYYYMMDD-HHmmss`.

Create the branch from the current HEAD and switch to it. Use a single worktree — no parallel execution needed.

---

### Step 4 — Execute

Implement the task directly. No requirement graph, no groups, no adversarial review.

Rules:
- Make the smallest change that satisfies the task description
- Touch only the files necessary
- Follow existing code patterns and conventions in the repo

---

### Step 5 — Verify

Run verification gates:

```
npx forge verify --gate types,lint,tests
```

**If verification fails:**
1. Read the error output
2. Fix the failing code
3. Re-run verification
4. Repeat until all gates pass (max 3 attempts)

If still failing after 3 attempts, stop and report the failures to the user.

---

### Step 6 — Complete

**Commit:**
- Stage only the files you changed (never `git add .`)
- Commit with the task description as the message

**PR or branch:**

<AskUserQuestion>
question: "How should I deliver this?"
options:
  - "Create a PR"
  - "Commit to current branch (no PR)"
</AskUserQuestion>

**If "Create a PR":** Push the branch and create a pull request with the task description as the title.

**If "Commit to current branch":** Work is already committed. Done.

**Linear cleanup (if tracking):**
- Transition the issue to **Done**
- Add the commit SHA or PR URL as a comment on the issue

---

### Step 7 — Report

Print a summary:

```
## Quick Task Complete

**Task:** {task description}
**Branch:** {branch name}
**Verification:** All gates passed
{if PR:} **PR:** {PR URL}
{if Linear:} **Issue:** {issue identifier} — Done
```

If anything failed, include a failures section:
```
**Issues:**
- {description of what failed}
```

---

## Linear State Reference

| Transition | State       |
|------------|-------------|
| Created    | Planned     |
| Work start | In Progress |
| Completed  | Done        |
