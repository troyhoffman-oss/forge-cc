# forge-cc Skills

Skills are markdown instruction files that Claude Code discovers and executes. When a user types a skill command (e.g., `/forge:triage`), Claude Code reads the corresponding markdown file and follows its instructions using available tools (MCP tools, Bash, file operations, etc.).

Skills are prompts, not code. The LLM interprets the instructions and orchestrates tool calls to execute the workflow.

## Installation

Copy or symlink the skill files into your Claude Code skills directory:

```bash
# Copy all skills
cp skills/forge-*.md ~/.claude/skills/

# Or symlink (updates automatically with forge-cc)
ln -s "$(pwd)/skills/forge-triage.md" ~/.claude/skills/forge-triage.md
```

Skills are also distributed via `npm install forge-cc` and can be found in `node_modules/forge-cc/skills/`.

## Available Skills

| Skill | Command | Description |
|-------|---------|-------------|
| Triage | `/forge:triage` | Brain dump to Linear projects. Paste unstructured ideas, get organized projects. |
| Spec | `/forge:spec` | Interview to PRD. Select a project, answer questions, get milestones + issues. *(coming soon)* |
| Go | `/forge:go` | Execute milestones. Wave-based agents, self-healing verification, auto mode. *(coming soon)* |

## Prerequisites

- Claude Code with MCP tools enabled
- Linear MCP tools configured (`mcp__linear__*`) for triage and spec skills
- `forge-cc` installed in the project for verification gates (used by go skill)
