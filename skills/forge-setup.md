# /forge:setup — Initialize or Refresh a Forge Project

Bootstrap a new project with forge-cc scaffolding, or refresh an existing project's forge files to the latest templates. Creates `.forge.json`, `CLAUDE.md`, planning docs, and installs hooks.

## Instructions

Follow these steps exactly. Do not skip confirmation.

### Step 1 — Detect Project

Check the current directory for existing forge files:

```bash
ls .forge.json CLAUDE.md tasks/lessons.md 2>/dev/null
```

Determine which files exist. This determines whether this is a fresh setup or a refresh.

- **If `.forge.json` exists:** This is an existing forge project → default to Refresh mode
- **If `.forge.json` does not exist:** This is a new project → default to Fresh Setup mode

### Step 2 — Choose Setup Mode

Present the detected mode and ask the user to confirm or override:

<AskUserQuestion>
question: "Detected {existing/new} forge project. Which mode?"
options:
  - "Fresh Setup — scaffold all forge files from scratch"
  - "Refresh — update existing files to latest templates (preserves Learned Rules and lessons)"
</AskUserQuestion>

**Fresh Setup** will create all files, overwriting any that exist.
**Refresh** will update templates while preserving:
- `CLAUDE.md` → keeps `## Learned Rules` section content
- `tasks/lessons.md` → keeps all existing lessons

### Step 3 — Configure Gates

Ask the user which verification gates to enable. **AskUserQuestion supports max 4 options — use TWO questions to cover all 8 gates:**

<AskUserQuestion>
question: "Which core gates should be active? (Recommended: all four)"
header: "Core gates"
multiSelect: true
options:
  - "types — TypeScript type checking (tsc --noEmit) (Recommended)"
  - "lint — ESLint / Biome linting (Recommended)"
  - "tests — Vitest / Jest test runner (Recommended)"
  - "prd — PRD completeness check"
</AskUserQuestion>

<AskUserQuestion>
question: "Enable any advanced gates? These require extra setup (Playwright, dev server, API access)."
header: "Advanced gates"
multiSelect: true
options:
  - "visual — Playwright screenshot regression (requires Playwright + Chromium)"
  - "runtime — Start the app and check for crashes (requires devServerUrl)"
  - "review — AI code review (runs during forge verify)"
  - "codex — Codex PR review polling (runs after PR creation)"
</AskUserQuestion>

Combine selections from both questions into the final gates list.

Also collect project metadata (skip in Refresh mode if `.forge.json` already has values):

<AskUserQuestion>
question: "Project name?"
</AskUserQuestion>

<AskUserQuestion>
question: "Tech stack? (e.g., TypeScript, React, Node.js)"
</AskUserQuestion>

<AskUserQuestion>
question: "One-line project description?"
</AskUserQuestion>

### Step 3.5 — Interactive Test Planning

**Skip this step if "tests" was NOT selected in Step 3.**

Run the test analysis engine on the project:

```typescript
import { analyzeForTestPlanning } from 'forge-cc/src/test-scaffold/analyze';
const analysis = await analyzeForTestPlanning(projectDir);
```

Present findings to the user:

```
## Test Analysis

**Framework detected:** {e.g., "Next.js App Router with Vitest"}
**Coverage summary:** Found {N} source files, {M} test files
```

For each category with untested files, ask:

<AskUserQuestion>
question: "Scaffold tests for {category description}? ({N} untested files)"
options:
  - "Yes — scaffold test stubs for these files"
  - "No — skip this category"
</AskUserQuestion>

If the test runner was NOT already detected from `package.json`, ask:

<AskUserQuestion>
question: "Which test runner?"
options:
  - "Vitest (Recommended)"
  - "Jest"
</AskUserQuestion>

Ask about structural tests:

<AskUserQuestion>
question: "Include structural tests? (circular import detection, file naming conventions)"
options:
  - "Yes (Recommended)"
  - "No"
</AskUserQuestion>

Print a summary of what will be scaffolded:

```
## Test Scaffold Plan

- Config file: {vitest.config.ts / jest.config.ts}
- Package.json updates: test script, devDependencies
- Test stubs: {count} across {categories}
- Structural tests: {Yes / No}
```

Store the scaffold plan for execution in Step 4. The testing config will be persisted to `.forge.json`.

### Step 4 — Create or Update Files

Use the template functions from `forge-cc/src/setup/templates.ts` to generate file contents. **Always include `forgeVersion` in the SetupContext** — read it from forge-cc's own `package.json` (`node_modules/forge-cc/package.json` → `.version` field). This stamps the installed version into `.forge.json` so the version-check hook can detect when a refresh is needed after an update. The templates are:

- `forgeConfigTemplate(ctx)` → `.forge.json` (includes `forgeVersion`)
- `claudeMdTemplate(ctx)` → `CLAUDE.md`
- `lessonsMdTemplate(ctx)` → `tasks/lessons.md`
- `gitignoreForgeLines()` → lines to append to `.gitignore`

**Fresh Setup mode:** Create all files. Create directories `.planning/` and `tasks/` if they don't exist. Append forge lines to `.gitignore` if not already present.

**Refresh mode:** Only overwrite `.forge.json` and the structural parts of `CLAUDE.md` (everything except `## Learned Rules`). Do NOT touch `lessons.md`.

Write the actual files using the Write tool. Do not just print them.

**If a test scaffold plan exists from Step 3.5**, also execute it now:
- Write the test runner config file (`vitest.config.ts` or `jest.config.ts`)
- Write test stub files for each selected category
- Write structural test files if selected
- Update `package.json` with test script and devDependencies
- Persist the `testing` section to `.forge.json`

**Cleanup deprecated files (both modes):** Check if `.planning/STATE.md` or `.planning/ROADMAP.md` exist. These are deprecated (replaced by per-PRD status JSON) and waste tokens every session. If either exists, ask the user:

<AskUserQuestion>
question: "Found deprecated .planning/STATE.md and/or ROADMAP.md. These are no longer used — how should we handle them?"
header: "Deprecated files"
options:
  - "Archive — move to .planning/archive/ (Recommended)"
  - "Delete — remove them permanently"
  - "Keep — leave them as-is"
</AskUserQuestion>

- **Archive:** `mkdir -p .planning/archive && mv .planning/STATE.md .planning/ROADMAP.md .planning/archive/ 2>/dev/null`
- **Delete:** `rm -f .planning/STATE.md .planning/ROADMAP.md`
- **Keep:** Do nothing (warn: "These files will burn tokens on startup if any CLAUDE.md still references them.")

### Step 5 — Patch Global Config

Check if `~/.claude/CLAUDE.md` exists:

- **If it does not exist:** Create it using `globalClaudeMdTemplate()` from the templates.
- **If it exists:** Leave it alone. Do not overwrite the user's global config.

### Step 6 — Install Skills

Copy all forge skills to `~/.claude/commands/forge/` so they're discoverable via `/forge:*`:

```bash
mkdir -p ~/.claude/commands/forge
```

Find the installed forge-cc package and copy skill files, stripping the `forge-` prefix:

```bash
SKILLS_DIR="$(dirname "$(which forge)")/../lib/node_modules/forge-cc/skills"
# Fallback: check local node_modules
if [ ! -d "$SKILLS_DIR" ]; then
  SKILLS_DIR="node_modules/forge-cc/skills"
fi

for f in "$SKILLS_DIR"/forge-*.md; do
  name=$(basename "$f" | sed 's/^forge-//')
  cp "$f" ~/.claude/commands/forge/"$name"
done
```

Print: "Installed forge skills to ~/.claude/commands/forge/"

### Step 7 — Environment Health Check

Run `forge doctor` to check for missing optional dependencies:

```bash
forge doctor
```

Review the output. If Playwright or Chromium is missing, ask the user:

<AskUserQuestion>
question: "Playwright enables visual regression + runtime testing but is not installed. Install now?"
options:
  - "Yes — run npm install -g playwright && npx playwright install chromium"
  - "No — skip for now (visual and runtime gates will be unavailable)"
</AskUserQuestion>

If yes, run the install commands:

```bash
npm install -g playwright && npx playwright install chromium
```

If the install succeeds, confirm: "Playwright + Chromium installed successfully."
If it fails, print the error and continue — this is not a blocker for setup.

If `forge doctor` shows all checks passing, print: "Environment checks passed." and continue.

### Step 8 — Install Hooks

The version-check hook **must always be installed**. Read the existing settings file (if any), merge the hook in, and write it back.

```bash
cat .claude/settings.local.json 2>/dev/null || echo "{}"
```

The target hook entry is:

```json
{
  "matcher": "Task",
  "hooks": [
    {
      "type": "command",
      "command": "node node_modules/forge-cc/hooks/version-check.js"
    }
  ]
}
```

**Merge logic — follow ALL 5 steps. Do NOT overwrite the file; you MUST read-merge-write to preserve existing user settings:**

1. Parse the existing file (or start with `{}`). **Use the Read tool first** — never write without reading.
2. Ensure `hooks.PreToolUse` exists as an array. If the key is missing, create it. If it exists, preserve all existing entries.
3. Check if any entry in `hooks.PreToolUse` already has a hook with `command` containing `version-check.js`. **If found, skip — already installed. Do not duplicate it.**
4. If NOT found, append the hook entry to `hooks.PreToolUse`. Do not replace existing entries.
5. Write the merged result back to `.claude/settings.local.json`, preserving ALL existing settings (permissions, other hooks, custom keys).

Create the `.claude/` directory if it doesn't exist (`mkdir -p .claude`).

### Step 9 — Run Verification

**Only verify setup-safe gates.** Several gates structurally cannot pass during setup because their prerequisites don't exist yet:

| Gate | Why it's deferred |
|------|-------------------|
| `prd` | No PRD file exists until `/forge:spec` runs |
| `visual` | Dev server may not be running; Playwright timeouts expected |
| `runtime` | Dev server may not be running |
| `codex` | Post-PR only — runs in Step 10 after PR creation |

**Setup-safe gates:** `types`, `lint`, `tests`, `review`

Build the `--gate` flag from the user's selected gates, keeping **only** the setup-safe ones:

```bash
npx forge verify --gate types,lint,tests,review
```

(Include only gates the user selected that are in the setup-safe set. If the user only selected `types` and `lint`, run `--gate types,lint`.)

**CRITICAL: NEVER remove a gate from `.forge.json` to make verification pass.** The `.forge.json` gates list is the user's full desired configuration for development. Deferred gates will be verified later during `/forge:go` and post-PR steps.

If any setup-safe gate fails, fix the issue before proceeding. Common fixes:
- **lint:** Run the project's lint autofix (e.g., `npx biome check --fix .`)
- **tests:** Convert failing stub tests to `it.todo('description')` so they show as pending
- **types:** Fix any type errors introduced by scaffolding

Re-run the setup-safe gates until they pass.

### Step 10 — Commit, PR, and Codex Review

Once all gates pass, automatically create a branch, commit, open a PR, and poll for Codex review.

**Create branch and commit:**

**IMPORTANT — CRLF check is mandatory before staging.** Run `git diff --stat` first. If any files show changes but have zero meaningful content diff (CRLF-only / whitespace-only noise on unrelated files), discard them with `git checkout -- <file>` BEFORE running `git add`. Skipping this check causes unrelated files to be included in the commit.

```bash
git checkout -b feat/forge-setup
git diff --stat  # Check for CRLF noise — discard any whitespace-only changes on unrelated files
git add -A
git commit -m "feat: initialize forge workflow scaffolding

- .forge.json config with gate selection
- CLAUDE.md project instructions
- .planning/ directory for PRD status tracking
- Test stubs and structural tests (if enabled)
- Version-check hook in .claude/settings.local.json

Co-Authored-By: Claude <noreply@anthropic.com>"
git push -u origin feat/forge-setup
```

**Open PR:**

```bash
gh pr create --title "feat: initialize forge workflow" --body "$(cat <<'EOF'
## Summary
- Scaffold forge verification gates, planning docs, and test infrastructure
- Gates configured: {comma-separated list}
- Test stubs: {N} it.todo() stubs as pending backlog + {N} structural tests passing

## Test plan
- [x] `npx forge verify` passes all gates
- [x] `npx tsc --noEmit` clean
- [ ] Codex review (auto-polling)
EOF
)"
```

**Codex Review Gate:**

After `gh pr create` succeeds, poll for Codex review comments:

1. **Poll loop:** Every 60 seconds, check for new PR review comments:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{pr_number}/comments
   ```

2. **Duration:** Poll for up to 8 minutes (8 checks at 60-second intervals).

3. **If comments found:** For each unresolved comment, address it — either fix the code or reply with justification. Push fixes and re-poll.

4. **Timeout:** If no comments appear after 8 minutes, proceed — Codex may not be configured for this repository.

**IMPORTANT:** Do NOT merge the PR automatically. Merging is a hard-to-reverse action that requires explicit user confirmation. Always stop here and let the user decide when to merge.

### Step 11 — Summary

Print a summary of everything that was created or updated:

```
## Forge Setup Complete

**Mode:** {Fresh Setup / Refresh}
**Project:** {projectName}
**Gates:** {comma-separated list}
**PR:** {PR URL}

### Files Created/Updated
- ~/.claude/commands/forge/*.md ✓ (skills)
- .forge.json ✓
- CLAUDE.md ✓
- tasks/lessons.md ✓
- .gitignore (forge lines) ✓
- .claude/settings.local.json ✓ (version-check hook)

### Test Planning
{If tests gate enabled: "Test planning: {N} test stubs scaffolded, {runner} configured, structural tests {included/skipped}"}
{If tests gate not enabled: "Test planning: skipped (tests gate not enabled)"}

### Verification
- All gates passed ✓
- Codex review: {resolved N comments / no comments / not configured}

### Next Steps
1. Review the generated `CLAUDE.md` and customize the Code Map section
2. Run `/forge:spec` to create a PRD for your first feature
```
