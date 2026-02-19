# forge-mcp — Lessons (max 10 active)

One-liner format: `- **[topic]** The rule`

- **[agent staging]** Restage all files at wave boundaries — parallel agents can disrupt each other's git index
- **[old file cleanup]** Delete old files immediately after migration to prevent type conflicts from stale code being compiled
- **[wave consolidation]** When a Wave 1 agent fully covers a Wave 2 task's scope (e.g., skill content), mark Wave 2 task complete and skip the redundant agent — don't spawn agents for already-done work
- **[cross-agent types]** Inline actual code from created files into downstream agent prompts — never use predicted/spec types that may differ from what was actually built
- **[between-wave verify]** Run `tsc --noEmit` between every wave, not just at the end — catches cross-agent integration issues before spawning the next wave's agents
- **[always delegate to builders]** Always spawn builder agents for implementation work, even for sequential tasks — the point is preserving the orchestrator's context window, not parallelism. The orchestrator coordinates and verifies; builders write code in their own context
- **[bulk ops in prompts]** When agents must delete/create many files, include the exact efficient shell command in their prompt (e.g., `rm -rf dir1 dir2`). Agents otherwise attempt file-by-file operations and stall
- **[milestone sizing]** Every milestone must be completable in one main agent context window. This is a hard constraint — if a milestone is too large, split it. Bake this into PRD templates and spec skill docs.
- **[no compaction chaining]** Never rely on Claude Code's context compaction for multi-milestone auto mode. Compacted context degrades quality. Fresh processes (like Huntley's `while :; do cat PROMPT.md | claude-code ; done`) are the correct pattern — file system is the only memory between iterations.
- **[biome CRLF on Windows]** When Biome reports mass formatting errors on Windows and `--write` doesn't fix them, check `formatter.lineEnding` in biome.json first — files are likely already LF but Biome is auto-detecting CRLF as the target.
- **[bash shell death recovery]** If Claude Code's bash shell starts returning exit code 1 with zero output, fall back to `node -e "..."` for the rest of the session — don't spend rounds debugging the shell.
- **[global npm on Windows]** To find globally-installed npm packages on Windows, use `process.env.APPDATA + '/npm/node_modules/<pkg>'` — don't rely on `require.resolve()` or bash path traversal (backslash escaping breaks in bash).
