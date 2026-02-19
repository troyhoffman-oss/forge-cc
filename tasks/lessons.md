# forge-mcp — Lessons (max 10 active)

One-liner format: `- **[topic]** The rule`

- **[agent staging]** Restage all files at wave boundaries — parallel agents can disrupt each other's git index
- **[cross-agent types]** Inline actual code from created files into downstream agent prompts — never use predicted/spec types that may differ from what was actually built
- **[between-wave verify]** Run `tsc --noEmit` between every wave, not just at the end — catches cross-agent integration issues before spawning the next wave's agents
- **[always delegate to builders]** Always spawn builder agents for implementation work, even for sequential tasks — the point is preserving the orchestrator's context window, not parallelism. The orchestrator coordinates and verifies; builders write code in their own context
- **[milestone sizing]** Every milestone must be completable in one main agent context window. This is a hard constraint — if a milestone is too large, split it. Bake this into PRD templates and spec skill docs.
- **[no compaction chaining]** Never rely on Claude Code's context compaction for multi-milestone auto mode. Compacted context degrades quality. Fresh processes (like Huntley's `while :; do cat PROMPT.md | claude-code ; done`) are the correct pattern — file system is the only memory between iterations.
- **[global npm on Windows]** To find globally-installed npm packages on Windows, use `process.env.APPDATA + '/npm/node_modules/<pkg>'` — don't rely on `require.resolve()` or bash path traversal (backslash escaping breaks in bash).
- **[single agent for cohesive work]** Don't split tightly-coupled issues into parallel waves — one agent with full context produces more integrated code. Reserve multi-wave for genuinely independent work (e.g., separate modules with no shared types).
- **[CLAUDECODE nesting guard]** When spawning `claude -p` as a subprocess, strip the `CLAUDECODE` env var — Claude Code blocks nested sessions via this env var, which breaks `forge run` when invoked from within a Claude session.
- **[silent failure is a bug]** `forge linear-sync` ran silently for 5 milestones and did nothing in Linear. "Degrade gracefully" must not mean "silently do nothing." CLI commands that touch external systems must print what they did or why they skipped. Always verify side effects actually happened — don't treat no output as success.
