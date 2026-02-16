# forge-cc

Pre-PR verification harness and development workflow tool for Claude Code agents. Gate runner + CLI + MCP server + workflow skills.

<!-- Badges: npm version, CI status, license -->

## What It Does

- **Verification gates** -- runs TypeScript type-checking, linting, tests, visual screenshots, runtime endpoint validation, and PRD acceptance criteria checks against your project before you commit.
- **Mechanical enforcement** -- Claude Code PreToolUse hook and git pre-commit hook block commits that haven't passed verification. No discipline required; the machine enforces it.
- **Workflow skills** -- `/forge:triage` turns brain dumps into Linear projects, `/forge:spec` interviews you and generates a PRD with milestones, `/forge:go` executes milestones with wave-based agent teams, `/forge:setup` scaffolds new projects, `/forge:update` keeps forge-cc current.
- **Linear lifecycle** -- programmatic status transitions through Backlog, Planned, In Progress, In Review, and Done. Every skill keeps Linear in sync automatically.

## Quick Start

```bash
# Install
npm install forge-cc

# Run verification against current project
npx forge verify

# Check last verification status
npx forge status
```

On first run with no `.forge.json`, forge auto-detects gates from your `package.json`:
- Has `typescript` in dependencies? Enables the **types** gate.
- Has `@biomejs/biome` or `biome` in dependencies? Enables the **lint** gate.
- Has a `test` script? Enables the **tests** gate.

## Configuration

Create a `.forge.json` in your project root to customize behavior:

```json
{
  "gates": ["types", "lint", "tests"],
  "maxIterations": 5,
  "verifyFreshness": 600000,
  "devServer": {
    "command": "npm run dev",
    "port": 3000,
    "readyPattern": "ready on"
  },
  "prdPath": ".planning/prds/active.md",
  "linearProject": "My Project"
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gates` | `string[]` | `["types", "lint", "tests"]` | Which verification gates to run |
| `maxIterations` | `number` | `5` | Max retry iterations for the verification pipeline |
| `verifyFreshness` | `number` | `600000` | How long (ms) a passing verification stays valid. Default: 10 minutes |
| `devServer.command` | `string` | -- | Command to start the dev server (for visual/runtime gates) |
| `devServer.port` | `number` | -- | Port the dev server listens on |
| `devServer.readyPattern` | `string` | -- | Stdout pattern indicating the server is ready |
| `prdPath` | `string` | -- | Path to PRD file for acceptance criteria checking |
| `linearProject` | `string` | -- | Linear project name for lifecycle tracking |

If no `.forge.json` exists, forge auto-detects from `package.json` (see Quick Start).

## CLI Commands

### `forge verify`

Run verification gates against the current project.

```bash
# Run all configured gates
npx forge verify

# Run specific gates only
npx forge verify --gate types,lint

# Output structured JSON (for programmatic use)
npx forge verify --json

# Include PRD acceptance criteria check
npx forge verify --prd .planning/prds/active.md
```

| Flag | Description |
|------|-------------|
| `--gate <gates>` | Comma-separated list of gates to run (overrides config) |
| `--json` | Output structured JSON instead of human-readable markdown |
| `--prd <path>` | Path to PRD file for the `prd` gate |

Exit code: `0` if all gates pass, `1` if any gate fails.

Results are cached to `.forge/last-verify.json` for freshness checking by hooks.

### `forge status`

Print current project state: branch, last verification result, config source.

```bash
npx forge status
```

Output includes which gates passed/failed, how long ago verification ran, and whether config is from `.forge.json` or auto-detected.

## Verification Gates

| Gate | What It Checks | Requires |
|------|---------------|----------|
| `types` | TypeScript compilation (`tsc --noEmit`) | `typescript` in dependencies |
| `lint` | Biome linting (`biome check`) | `@biomejs/biome` in dependencies |
| `tests` | Test suite (`npm run test`) | A `test` script in `package.json` |
| `visual` | Playwright screenshots + console error detection | Dev server config, `playwright` |
| `runtime` | HTTP endpoint validation (status codes, response shape) | Dev server config, endpoint list |
| `prd` | Diff against PRD acceptance criteria | PRD file path, git history |

**Pipeline behavior:** Gates run in order. If all three core gates (types, lint, tests) fail, remaining gates are skipped. Each gate returns structured results with file paths, line numbers, and error messages.

## Enforcement

forge-cc provides two enforcement mechanisms that block commits without passing verification.

### Claude Code PreToolUse Hook

The recommended enforcement for Claude Code users. Intercepts `git commit` commands and checks:

1. **Branch protection** -- blocks commits directly to `main` or `master`.
2. **Verification required** -- blocks if no `.forge/last-verify.json` exists.
3. **Verification passed** -- blocks if the last run failed.
4. **Freshness** -- blocks if verification is older than `verifyFreshness` (default 10 min).

**Install:**

Add to your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/forge-cc/hooks/pre-commit-verify.js"
          }
        ]
      }
    ]
  }
}
```

### Version Check Hook

Optional session hook that checks for forge-cc updates when Claude Code starts a task. Prints a one-line notice to stderr if a newer version is available. Never blocks execution.

Add to `.claude/settings.local.json`:

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

`/forge:setup` installs this hook automatically.

### Git Pre-Commit Hook

Standard git hook for non-Claude-Code environments. Same four checks as the PreToolUse hook.

The hook logic lives in `src/hooks/pre-commit.ts` and can be wired into any git hook runner (husky, simple-git-hooks, etc.).

## MCP Server

forge-cc registers its gates as MCP tools so agents can call them programmatically.

**Configure in `.mcp.json`:**

```json
{
  "mcpServers": {
    "forge-cc": {
      "command": "node",
      "args": ["node_modules/forge-cc/dist/server.js"]
    }
  }
}
```

**Available MCP tools:**

| Tool | Description |
|------|-------------|
| `forge_verify_types` | Run TypeScript type checking |
| `forge_verify_lint` | Run Biome linting |
| `forge_verify_tests` | Run project test suite |
| `forge_verify_visual` | Take screenshots, check console errors |
| `forge_verify_runtime` | Validate API endpoints |
| `forge_verify_prd` | Check changes against PRD criteria |
| `forge_run_pipeline` | Run full verification pipeline |

All tools accept `projectDir` (absolute path) and return structured JSON results.

## Workflow Skills

Claude Code skills that drive the full development lifecycle. Invoke them with slash commands.

### `/forge:triage` -- Brain Dump to Linear Projects

Paste unstructured ideas, sticky notes, or stream-of-consciousness text. The skill extracts distinct projects, deduplicates against your existing Linear backlog, and creates them after your confirmation.

**Flow:** Input text -> extract projects -> deduplicate against Linear -> confirm -> create in Linear (Backlog state).

### `/forge:spec` -- Interview to PRD

Select a Linear project in Backlog state. The skill scans your codebase (structure, patterns, dependencies), conducts an adaptive interview (leading with recommendations, not blank-slate questions), generates a PRD with milestones, and syncs the plan back to Linear.

**Flow:** Select project -> scan codebase -> interview -> generate PRD -> create milestones + issues in Linear -> move project to Planned.

### `/forge:go` -- Execute Milestones

Execute the next pending milestone from your PRD with wave-based agent teams. Each wave runs parallel agents for independent work, with verification between waves. Supports `--auto` to chain all remaining milestones without manual intervention.

**Flow:** Orient (read state) -> pre-flight checks -> execute waves -> verify -> update state -> (optional) create PR.

### `/forge:setup` -- Initialize or Refresh a Project

Bootstrap a new project with forge-cc scaffolding (`.forge.json`, `CLAUDE.md`, planning docs, hooks), or refresh an existing project's files to the latest templates while preserving your learned rules and lessons.

**Flow:** Detect project -> choose mode (Fresh/Refresh) -> configure gates -> create files -> patch global config -> install hooks -> summary.

### `/forge:update` -- Update Forge

Check for newer versions of forge-cc and install the latest. After updating, suggests running `/forge:setup` in Refresh mode to pick up new templates.

**Flow:** Check versions -> compare -> update via npm -> post-update check.

## Linear Integration

forge-cc manages the full Linear project lifecycle:

```
Backlog  ->  Planned  ->  In Progress  ->  In Review  ->  Done
  |            |              |               |            |
triage     spec/PRD      go/execute      PR created    PR merged
```

Each skill transitions projects and issues to the appropriate status automatically. The Linear client (`src/linear/client.ts`) handles GraphQL queries, and dedicated modules manage projects, milestones, and issues.

## Multi-Developer Setup

For a new developer joining the team:

1. **Clone the repo** that uses forge-cc.
2. **Install dependencies:** `npm install` (forge-cc should be in `devDependencies`).
3. **Run `/forge:setup`** -- scaffolds `.forge.json`, `CLAUDE.md`, planning docs, and installs hooks automatically. Or set up manually:
   - `npx forge verify` to confirm your environment.
   - Add the PreToolUse hook to `.claude/settings.json` (see Enforcement section).
   - Create `.forge.json` if auto-detected gates don't match.

The gates run the same commands your CI does, so if `npx forge verify` passes locally, CI will pass too.

## Project Structure

```
forge-cc/
  src/
    cli.ts              # CLI entry point (npx forge)
    server.ts           # MCP server entry point
    types.ts            # Core type definitions
    gates/              # Verification gates (types, lint, tests, visual, runtime, prd)
    linear/             # Linear API client + lifecycle management
    hooks/              # Pre-commit hook logic
    config/             # .forge.json schema + auto-detection loader
    reporter/           # Human (markdown) and JSON output formatting
    state/              # Session state reader/writer (STATE.md, ROADMAP.md)
    spec/               # Spec interview engine + PRD generation
    go/                 # Execution engine + verify loop + PR creation
    setup/              # Setup templates for project scaffolding
  skills/               # Claude Code skill definitions (/forge:triage, /forge:spec, /forge:go, /forge:setup, /forge:update)
  hooks/                # Installable hook files (PreToolUse, version-check)
  tests/                # Test suite (vitest)
  .forge.json           # Default configuration
```

## Development

Working on forge-cc itself:

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode (rebuild on changes)
npm run dev

# Run verification on forge-cc itself
npm run verify
```

**Tech stack:** TypeScript (ES2022, strict), Node.js, `@modelcontextprotocol/sdk`, Commander, Playwright, Zod, Vitest.

## License

MIT
