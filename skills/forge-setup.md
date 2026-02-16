# /forge:setup — Initialize or Refresh a Forge Project

Bootstrap a new project with forge-cc scaffolding, or refresh an existing project's forge files to the latest templates. Creates `.forge.json`, `CLAUDE.md`, planning docs, and installs hooks.

## Instructions

Follow these steps exactly. Do not skip confirmation.

### Step 1 — Detect Project

Check the current directory for existing forge files:

```bash
ls .forge.json CLAUDE.md .planning/STATE.md .planning/ROADMAP.md tasks/lessons.md 2>/dev/null
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
- `.planning/STATE.md` → keeps current state
- `.planning/ROADMAP.md` → keeps current roadmap

### Step 3 — Configure Gates

Ask the user which verification gates to enable:

<AskUserQuestion>
question: "Which verification gates should be active?"
multiSelect: true
options:
  - "types — TypeScript type checking (tsc --noEmit)"
  - "lint — ESLint / Biome linting"
  - "tests — Vitest / Jest test runner"
  - "visual — Playwright screenshot regression"
  - "runtime — Start the app and check for crashes"
  - "prd — PRD completeness check"
</AskUserQuestion>

Default recommendation: `types`, `lint`, `tests`.

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

Use the template functions from `forge-cc/src/setup/templates.ts` to generate file contents. The templates are:

- `forgeConfigTemplate(ctx)` → `.forge.json`
- `claudeMdTemplate(ctx)` → `CLAUDE.md`
- `stateMdTemplate(ctx)` → `.planning/STATE.md`
- `roadmapMdTemplate(ctx)` → `.planning/ROADMAP.md`
- `lessonsMdTemplate(ctx)` → `tasks/lessons.md`
- `gitignoreForgeLines()` → lines to append to `.gitignore`

**Fresh Setup mode:** Create all files. Create directories `.planning/` and `tasks/` if they don't exist. Append forge lines to `.gitignore` if not already present.

**Refresh mode:** Only overwrite `.forge.json` and the structural parts of `CLAUDE.md` (everything except `## Learned Rules`). Do NOT touch `STATE.md`, `ROADMAP.md`, or `lessons.md`.

Write the actual files using the Write tool. Do not just print them.

**If a test scaffold plan exists from Step 3.5**, also execute it now:
- Write the test runner config file (`vitest.config.ts` or `jest.config.ts`)
- Write test stub files for each selected category
- Write structural test files if selected
- Update `package.json` with test script and devDependencies
- Persist the `testing` section to `.forge.json`

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

Check if the user has a `.claude/settings.json` or `.claude/settings.local.json` in the project:

```bash
ls .claude/settings.json .claude/settings.local.json 2>/dev/null
```

If no settings file exists, create `.claude/settings.local.json` with the version-check hook:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/forge-cc/hooks/version-check.js"
          }
        ]
      }
    ]
  }
}
```

If a settings file already exists, inform the user:

> Settings file already exists. To add the version-check hook manually, add this to your hooks config:
> `"command": "node node_modules/forge-cc/hooks/version-check.js"`

### Step 9 — Summary

Print a summary of everything that was created or updated:

```
## Forge Setup Complete

**Mode:** {Fresh Setup / Refresh}
**Project:** {projectName}
**Gates:** {comma-separated list}

### Files Created/Updated
- ~/.claude/commands/forge/*.md ✓ (skills)
- .forge.json ✓
- CLAUDE.md ✓
- .planning/STATE.md ✓
- .planning/ROADMAP.md ✓
- tasks/lessons.md ✓
- .gitignore (forge lines) ✓
- .claude/settings.local.json ✓ (version-check hook)

### Test Planning
{If tests gate enabled: "Test planning: {N} test stubs scaffolded, {runner} configured, structural tests {included/skipped}"}
{If tests gate not enabled: "Test planning: skipped (tests gate not enabled)"}

### Next Steps
1. Review the generated `CLAUDE.md` and customize the Code Map section
2. Run `npx forge verify` to test your gate configuration
3. Run `/forge:spec` to create a PRD for your first feature
```

---

Do NOT commit or push. The user decides when to commit the scaffolded files.
