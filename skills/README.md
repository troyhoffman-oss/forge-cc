# forge-cc Skills

Skills are markdown instruction files that Claude Code discovers and executes. When a user types a skill command (e.g., `/forge:capture`), Claude Code reads the corresponding markdown file and follows its instructions using available tools (Bash, file operations, etc.).

Skills are prompts, not code. The LLM interprets the instructions and orchestrates tool calls to execute the workflow.

## Installation

Copy or symlink the skill files into your Claude Code skills directory:

```bash
# Copy all skills
cp skills/forge-*.md ~/.claude/skills/

# Or symlink (updates automatically with forge-cc)
ln -s "$(pwd)/skills/forge-capture.md" ~/.claude/skills/forge-capture.md
```

Skills are also distributed via `npm install forge-cc` and can be found in `node_modules/forge-cc/skills/`.

## Available Skills

| Skill | Command | Description |
|-------|---------|-------------|
| Capture | `/forge:capture` | Brain dump to Linear projects. Paste unstructured ideas, get organized projects. |
| Plan | `/forge:plan` | Interview to requirement graph. Adaptive interview, vertical slice enforcement, graph generation. |
| Build | `/forge:build` | Graph execution with adversarial review. Worktree isolation, Linear state transitions. |
| Fix | `/forge:fix` | Surgical recovery for failed requirements. Targeted fixes with adversarial review. |
| Quick | `/forge:quick` | Ad-hoc tasks without planning ceremony. Direct build → verify with optional Linear tracking. |

## Prerequisites

- Claude Code installed
- `LINEAR_API_KEY` set in your environment for Linear integration (used by capture, plan, and build skills)
- `forge-cc` installed in the project for verification gates and Linear CLI commands
