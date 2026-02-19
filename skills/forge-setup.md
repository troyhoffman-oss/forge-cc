# /forge:setup — Initialize or Refresh a Forge Project

Bootstrap a new project with forge-cc scaffolding, or refresh an existing project's forge files to the latest templates. The `forge setup` CLI handles all file operations; this skill handles the conversation layer.

## Instructions

Follow these steps exactly. Do not skip confirmation.

### Step 1 — Detect Project State

Check the current directory for existing forge files:

```bash
ls .forge.json CLAUDE.md 2>/dev/null
```

- **If `.forge.json` exists:** This is an existing forge project (Refresh mode)
- **If `.forge.json` does not exist:** This is a new project (Fresh Setup mode)

Present the detected mode:

<AskUserQuestion>
question: "Detected {existing/new} forge project. Which mode?"
options:
  - "Fresh Setup — scaffold all forge files from scratch"
  - "Refresh — update existing files to latest templates (preserves Learned Rules and lessons)"
</AskUserQuestion>

### Step 2 — Run Setup CLI

Run the forge setup CLI, which handles:
- Generating `.forge.json` with auto-detected gates
- Installing skill files to `~/.claude/commands/forge/`
- Installing pre-commit hook
- Appending forge section to CLAUDE.md
- Validating Linear connection

```bash
npx forge setup
```

Review the output. If `.forge.json` was created, read it and show the auto-detected configuration to the user.

### Step 3 — Interactive Configuration

If this is a Fresh Setup (or the user wants to reconfigure), ask about gate selection:

<AskUserQuestion>
question: "Which core gates should be active? (Recommended: all three)"
header: "Core gates"
multiSelect: true
options:
  - "types — TypeScript type checking (tsc --noEmit) (Recommended)"
  - "lint — ESLint / Biome linting (Recommended)"
  - "tests — Vitest / Jest test runner (Recommended)"
  - "prd — PRD completeness check"
</AskUserQuestion>

<AskUserQuestion>
question: "Enable any advanced gates? These require extra setup."
header: "Advanced gates"
multiSelect: true
options:
  - "visual — Playwright screenshot regression"
  - "runtime — Start the app and check for crashes"
  - "review — AI code review (runs during forge verify)"
  - "codex — Codex PR review polling (runs after PR creation)"
</AskUserQuestion>

If the user's selections differ from the auto-detected gates in `.forge.json`, update the `gates` array in `.forge.json` to match their choices.

For Refresh mode, skip gate selection unless the user explicitly wants to change gates.

### Step 4 — Environment Health Check

Run the doctor CLI to check for missing dependencies:

```bash
npx forge doctor
```

Review the output. If any checks show errors, help the user resolve them. If Playwright is missing and the user selected visual/runtime gates, offer to install it:

<AskUserQuestion>
question: "Playwright is not installed but visual/runtime gates require it. Install now?"
options:
  - "Yes — install Playwright + Chromium"
  - "No — skip for now (visual and runtime gates will be unavailable)"
</AskUserQuestion>

If yes:

```bash
npm install -g playwright && npx playwright install chromium
```

### Step 5 — Verification

Run the setup-safe gates to verify everything is working:

| Gate | Why it's deferred |
|------|-------------------|
| `prd` | No PRD file exists until `/forge:spec` runs |
| `visual` | Dev server may not be running |
| `runtime` | Dev server may not be running |
| `codex` | Post-PR only |

Build the `--gate` flag from the user's selected gates, keeping **only** the setup-safe ones (`types`, `lint`, `tests`, `review`):

```bash
npx forge verify --gate types,lint,tests
```

(Include only gates the user selected that are in the setup-safe set.)

**CRITICAL: NEVER remove a gate from `.forge.json` to make verification pass.** Deferred gates will be verified later during `/forge:go`.

If any gate fails, fix the issue before proceeding.

### Step 6 — Commit, PR, and Review

Once all gates pass, create a branch, commit, and open a PR:

**IMPORTANT — CRLF check is mandatory before staging.** Run `git diff --stat` first. If any files show whitespace-only changes on unrelated files, discard them with `git checkout -- <file>` BEFORE staging.

```bash
git checkout -b feat/forge-setup
git diff --stat
git add .forge.json CLAUDE.md .forge/ .claude/ tasks/
git commit -m "feat: initialize forge workflow scaffolding

- .forge.json config with gate selection
- CLAUDE.md project instructions
- Pre-commit hook
- Version-check hook

Co-Authored-By: Claude <noreply@anthropic.com>"
git push -u origin feat/forge-setup
```

Open PR:

```bash
gh pr create --title "feat: initialize forge workflow" --body "$(cat <<'EOF'
## Summary
- Scaffold forge verification gates, planning docs, and hook infrastructure
- Gates configured: {comma-separated list}

## Test plan
- [x] `npx forge verify` passes all setup-safe gates
- [x] `npx forge doctor` all checks pass
- [ ] Codex review (auto-polling)
EOF
)"
```

If the `codex` gate is enabled, poll for Codex review comments (up to 8 minutes, 60-second intervals). Address any comments found.

**IMPORTANT:** Do NOT merge the PR automatically. Let the user decide when to merge.

### Step 7 — Summary

Print a summary:

```
## Forge Setup Complete

**Mode:** {Fresh Setup / Refresh}
**Gates:** {comma-separated list}
**PR:** {PR URL}

### Files Created/Updated
- .forge.json
- CLAUDE.md (forge section)
- .forge/hooks/pre-commit-verify.js
- ~/.claude/commands/forge/*.md (skills)

### Verification
- Setup-safe gates passed
- Doctor checks: {pass/issues found}

### Next Steps
1. Review the generated `CLAUDE.md` and customize as needed
2. Run `/forge:spec` to create a PRD for your first feature
```
