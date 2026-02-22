# /forge:fix — Surgical Recovery

Fix a specific failed or broken requirement with targeted diagnosis, minimal changes, and re-verification. This is the recovery path when `/forge:build` fails a requirement after max iterations.

**Trigger:** `/forge:fix <req-id>` or `/forge:fix` (interactive selection)

## Prerequisites

- Requirement graph exists in `.planning/graph/{slug}/` (created by `/forge:plan`)
- At least one requirement with status `in_progress` or `failed`
- `LINEAR_API_KEY` set in environment
- `.forge.json` with `linearTeam` configured
- `ForgeLinearClient` available from `forge-cc`

## Instructions

Follow these steps exactly. Targeted fix only — do not rewrite the entire requirement.

---

### Step 0 — Select Requirement

**If `<req-id>` is provided:** Load that requirement directly. If it does not exist or is already `complete`, print an error and exit.

**If no req-id provided:** Scan the graph for fixable requirements.

```
index = loadIndex(projectDir, slug)
fixable = index.requirements.filter(r => r.status === "in_progress" || r.status === "failed")
```

If no fixable requirements exist, print: "No failed or in-progress requirements found. Nothing to fix." and exit.

If exactly one fixable requirement exists, select it automatically.

If multiple exist:

<AskUserQuestion>
question: "Which requirement needs fixing?"
options:
  - "{reqId}: {title} — {status} ({last error summary})"
  - ...for each fixable requirement
</AskUserQuestion>

---

### Step 1 — Load Context

Gather all context needed for diagnosis. Loading order:

1. **Requirement file** — the full requirement spec from `.planning/graph/{slug}/{reqId}.md`
2. **Direct dependencies** — requirement files for all deps (completed artifacts = actual file contents on disk)
3. **Current file state** — read the actual files listed in the requirement's `creates`/`modifies` from disk
4. **Last verification errors** — from the build session, if a worktree was preserved
5. **Adversarial review findings** — from the last review pass, if available

If a worktree from `/forge:build` still exists for this requirement (branch `feat/{slug}/{reqId}`), use it. Otherwise, create a new worktree:

```
createWorktree(projectDir, "fix/{slug}/{reqId}")
```

---

### Step 2 — Diagnose

Analyze the loaded context and present a structured diagnosis to the user:

```
## Diagnosis: {reqId} — "{title}"

**Files expected:**
- {file}: {exists ✓ / missing ✗}
- ...

**Verification results:**
- Types: {PASS / FAIL (N errors)}
- Lint: {PASS / FAIL (N errors)}
- Tests: {PASS / FAIL (N failures)}

**Review findings:**
- {finding 1}
- {finding 2}
- ...

**Root cause:**
{1-2 sentence diagnosis of what specifically needs to change}
```

The diagnosis must be specific — not "tests fail" but "ProfileForm.tsx missing toast notification after successful PUT, causing acceptance criterion 3 to fail."

---

### Step 3 — Fix

Apply a targeted fix. Rules:

- **Minimal changes only.** Fix the root cause identified in Step 2. Do not refactor surrounding code, add features, or "improve" anything beyond the fix.
- **Delegate to a builder agent.** Spawn a builder agent with:
  - The requirement file
  - The diagnosis from Step 2
  - The current file contents (actual code, not summaries)
  - Explicit instruction: "Fix ONLY the identified issue. Do not rewrite the requirement."
- **Run verification gates** after the fix: `types`, `lint`, `tests` in the worktree.
- **Run adversarial review** after verification passes. See `ref/adversarial-review.md` for the full protocol.
- **Max 3 fix iterations.** Each iteration: fix → verify → review. If iteration 3 still fails:

<AskUserQuestion>
question: "Fix for {reqId} failed after 3 attempts. Remaining issues:
{list of failures}

How would you like to proceed?"
options:
  - "Retry — reset iteration count and try again"
  - "Abandon — leave requirement as failed"
  - "Manual — I'll fix it myself, then re-verify"
</AskUserQuestion>

**If "Manual":** Print the worktree path and remaining failures. Wait for the user to signal they're done, then re-run verification and review.

Run `npx tsc --noEmit` between every fix iteration to catch integration issues early.

---

### Step 4 — Complete

**If verified and review passes:**

1. Merge the worktree back:
   ```
   mergeWorktree()
   removeWorktree()
   ```
2. Update graph status:
   ```
   updateRequirementStatus(projectDir, slug, reqId, "complete")
   ```
3. Sync Linear: Issue → Done
4. Print result:

```
## Fix Complete: {reqId} — "{title}"

**Root cause:** {diagnosis}
**Fix applied:** {1-2 sentence summary of what changed}
**Verification:** All gates pass
**Review:** PASS
**Linear:** Issue → Done
```

**If abandoned or manual-incomplete:**

Print the current state and preserve the worktree for later:

```
## Fix Incomplete: {reqId} — "{title}"

**Status:** {failed / manual-pending}
**Worktree:** {path} (preserved)
**Remaining issues:** {list}
```

---

### Step 5 — Resume Build (optional)

After a successful fix, offer to resume execution:

<AskUserQuestion>
question: "Requirement fixed. Want to resume the build?"
options:
  - "Yes — run forge:build"
  - "No — done for now"
</AskUserQuestion>

**If "Yes":** Invoke `/forge:build --prd {slug}`. It will reload the graph, pick up the newly completed requirement, and continue with the next ready requirement.

**If "No":** Print "Fix session complete." and exit.

---

## Linear State Reference

| Item | Transition | When |
|------|-----------|------|
| Issue | In Progress → Done | Requirement verified + merged after fix |

**If any Linear transition fails:** Log a warning and continue. Never block the fix on Linear API failures.

---

## Key References

- `ref/adversarial-review.md` — Full review protocol (reviewer receives requirement file + actual files on disk, NOT diff/builder summary; stub detection; PASS/FAIL output)
- `ref/graph-correction.md` — Mid-execution correction protocol (for context on how graph state evolves)

## Graph Module API

These TypeScript functions are available for graph operations:

- `loadIndex(projectDir, slug)` — Load `_index.yaml` from `.planning/graph/{slug}/`
- `writeIndex(projectDir, slug, index)` — Write `_index.yaml`
- `findReady(index)` — Return requirement IDs with all deps complete
- `updateRequirementStatus(projectDir, slug, reqId, status)` — Update a requirement's status
- `createWorktree(projectDir, branch)` — Create a git worktree for isolated execution
- `mergeWorktree()` — Merge worktree branch back into the feature branch
- `removeWorktree()` — Clean up worktree after merge
