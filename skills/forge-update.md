# /forge:update — Update Forge to Latest Version

Check for updates and install the latest version of forge-cc.

## Instructions

### Step 1 — Check Versions

Run the forge update CLI to check for a newer version:

```bash
npx forge update
```

Also get the exact installed version:

```bash
npx forge --version
```

If `forge` is not found, print: "forge-cc is not installed. Install with: `npm install -g forge-cc`"

### Step 2 — Compare and Report

Print the version status:

```
## Forge Version Check

**Installed:** v{current}
**Latest:** v{latest}
**Status:** {Up to date / Update available}
```

If already up to date, stop here with: "You're on the latest version."

### Step 3 — Update

If an update is available, run:

```bash
npm install -g forge-cc@latest
```

The `postinstall` hook automatically runs `forge setup --skills-only` to sync all skills to `~/.claude/commands/forge/`.

Verify the update succeeded:

```bash
npx forge --version
```

If the version matches the latest, the update is complete. If not, check if the user needs to restart their terminal or if a local `node_modules` is shadowing the global install.

### Step 4 — Verify Skills Synced

Confirm skills were updated:

```bash
ls ~/.claude/commands/forge/
```

If the directory is empty or missing, the postinstall hook may have failed. Run the manual fallback:

```bash
npx forge setup --skills-only
```

### Step 5 — Post-Update Check

If `.forge.json` exists in the current directory, suggest: "Run `/forge:setup` with Refresh mode to update project files to the latest templates."

Print final summary:

```
## Update Complete

**Previous:** v{old}
**Current:** v{new}
**Skills:** Synced to ~/.claude/commands/forge/

{If forge project: "Consider running `/forge:setup` (Refresh) to update project files."}
```

---

Do NOT stage, commit, or push anything. This skill only manages the npm package.
