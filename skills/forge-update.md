# /forge:update — Update Forge to Latest Version

Check for updates and install the latest version of forge-cc.

## Instructions

### Step 1 — Check Versions

Run these commands to get version info:

```bash
# Current installed version
forge --version

# Latest available version
npm view forge-cc version
```

Parse both versions. If the command fails, handle gracefully:
- If `forge` is not found: print "forge-cc is not installed globally. Install with: `npm install -g forge-cc`"
- If npm view fails (offline): print "Could not reach npm registry. Check your internet connection."

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

This does two things automatically:
1. Installs the new version globally
2. The `postinstall` hook runs `forge setup --skills-only`, which syncs all skills to `~/.claude/commands/forge/`

Verify the update succeeded:

```bash
forge --version
```

If the version matches the latest, the update is complete. If it doesn't match, check if the user needs to restart their terminal or if there's a local `node_modules` shadowing the global install.

### Step 4 — Verify Skills Synced

Confirm skills were updated by listing the target directory:

```bash
ls ~/.claude/commands/forge/
```

If the directory is empty or missing, the postinstall hook may have failed silently. Run the manual fallback:

```bash
forge setup --skills-only
```

### Step 5 — Post-Update Check

After updating, check if the current project's forge files need refreshing:

1. Check if `.forge.json` exists in the current directory
2. If it does (this is a forge project), suggest: "Run `/forge:setup` with Refresh mode to update project files to the latest templates."
3. If it doesn't, just confirm the update.

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
