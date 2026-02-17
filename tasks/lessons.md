# forge-mcp — Lessons (max 10 active)

One-liner format: `- **[topic]** The rule`

- **[agent staging]** Restage all files at wave boundaries — parallel agents can disrupt each other's git index
- **[old file cleanup]** Delete old files immediately after migration to prevent type conflicts from stale code being compiled
- **[wave consolidation]** When a Wave 1 agent fully covers a Wave 2 task's scope (e.g., skill content), mark Wave 2 task complete and skip the redundant agent — don't spawn agents for already-done work
- **[cross-agent types]** Inline actual code from created files into downstream agent prompts — never use predicted/spec types that may differ from what was actually built
- **[between-wave verify]** Run `tsc --noEmit` between every wave, not just at the end — catches cross-agent integration issues before spawning the next wave's agents
- **[AskUserQuestion limit]** AskUserQuestion supports max 4 options per call. When presenting more than 4 choices (e.g., 8 verification gates), split into multiple questions — the agent will silently truncate the list otherwise, hiding options from the user
- **[interview mode]** forge:spec interview MUST always use AskUserQuestion with multiple-choice options — never text-based numbered questions. Update the skill and interview engine to enforce this.
- **[milestone sizing]** Every milestone must be completable in one main agent context window. This is a hard constraint — if a milestone is too large, split it. Bake this into PRD templates and spec skill docs.
- **[no compaction chaining]** Never rely on Claude Code's context compaction for multi-milestone auto mode. Compacted context degrades quality. Fresh processes (like Huntley's `while :; do cat PROMPT.md | claude-code ; done`) are the correct pattern — file system is the only memory between iterations.
- **[spec interviews: don't overthink]** When speccing a feature, don't spiral into increasingly complex implementation options. Present the simplest viable approach first. If the user pushes back, explore alternatives — but don't pre-explore 5 options before the user asks.
