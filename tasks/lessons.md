# forge-mcp — Lessons (max 10 active)

One-liner format: `- **[topic]** The rule`

- **[agent staging]** Restage all files at wave boundaries — parallel agents can disrupt each other's git index
- **[old file cleanup]** Delete old files immediately after migration to prevent type conflicts from stale code being compiled
- **[wave consolidation]** When a Wave 1 agent fully covers a Wave 2 task's scope (e.g., skill content), mark Wave 2 task complete and skip the redundant agent — don't spawn agents for already-done work
- **[cross-agent types]** Inline actual code from created files into downstream agent prompts — never use predicted/spec types that may differ from what was actually built
