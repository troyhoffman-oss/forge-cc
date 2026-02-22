<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/forge--cc-Autonomous_Dev_Workflow-white?style=for-the-badge&labelColor=000000" />
    <img src="https://img.shields.io/badge/forge--cc-Autonomous_Dev_Workflow-000000?style=for-the-badge&labelColor=white" alt="forge-cc" />
  </picture>
</p>

<p align="center">
  <strong>Idea to merged PR. Autonomous agent teams. Zero manual git.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/forge-cc"><img src="https://img.shields.io/npm/v/forge-cc?style=flat-square&color=0969da" alt="npm" /></a>
  <img src="https://img.shields.io/badge/Claude_Code-plugin-7c3aed?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkw0IDdWMTdMMTIgMjJMMjAgMTdWN0wxMiAyWiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=&logoColor=white" alt="Claude Code" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="node" />
  <img src="https://img.shields.io/npm/l/forge-cc?style=flat-square&color=22863a" alt="MIT" />
</p>

---

## What is forge-cc?

forge-cc is a Claude Code plugin that turns your AI coding agent into an autonomous development team. You describe what you want to build. Forge breaks it into milestones, spins up parallel agent teams in isolated worktrees, verifies every line of code through automated gates, and creates the PR -- all without you touching git.

```
npm install -g forge-cc
```

---

## The Workflow

Five skill commands take you from raw idea to production-ready, merged code.

```
 +-----------------------------------------------------------------------------------+
 |                                                                                   |
 |   YOU HAVE AN IDEA            FORGE DOES THE REST                                 |
 |                                                                                   |
 |   "We need auth,        +-----------+  +-----------+  +-----------+               |
 |    a dashboard,         |           |  |           |  |           |               |
 |    and email            |  TRIAGE   +-->   SPEC    +-->    GO     |               |
 |    notifications"       |           |  |           |  |           |               |
 |                         +-----+-----+  +-----+-----+  +-----+-----+              |
 |                               |              |              |                     |
 |                         Creates Linear   Scans codebase   Agent teams             |
 |                         projects from    + interviews     build each              |
 |                         brain dump       you + generates  milestone               |
 |                                          PRD + milestones in worktrees            |
 |                                                              |                    |
 |                                                              v                    |
 |                                                    +----------------+             |
 |                                                    |  VERIFY + PR   |             |
 |                                                    +----------------+             |
 |                                                                                   |
 +-----------------------------------------------------------------------------------+
```

### `/forge:triage` -- Brain Dump to Backlog

Paste sticky notes, Slack messages, or stream-of-consciousness feature ideas. Forge extracts distinct projects, deduplicates against your existing Linear backlog, and creates them after your confirmation.

### `/forge:spec` -- Project to PRD

Pick a project from Linear. Forge scans your codebase in parallel (structure, routes, dependencies, patterns), then conducts an adaptive interview -- leading with recommendations based on what it found, not blank-slate questions. The output is a full PRD with milestones sized to fit agent context windows, synced back to Linear with issues and status tracking.

### `/forge:go` -- Milestones to Merged Code

This is the engine. Each milestone is executed by an autonomous agent team:

```
 +---------------------------------------------------------------------+
 |  EXECUTIVE  (orchestrator)                                          |
 |  Plans waves, assigns tasks, resolves escalations                   |
 +---------------------------------------------------------------------+
 |  REVIEWER  (persistent across all waves)                            |
 |  Reviews diff against PRD after each wave                           |
 |  Findings go through consensus protocol with builders               |
 +-------------------+-------------------+-----------------------------+
 |  BUILDER 1        |  BUILDER 2        |  BUILDER N ...              |
 |  Parallel agents  |  Parallel agents  |  Each gets a task,          |
 |  within each wave |  within each wave |  writes + tests code        |
 +-------------------+-------------------+-----------------------------+
 |  NOTETAKER  (optional, for 3+ waves or 4+ agents)                   |
 |  Tracks decisions, file ownership, cross-agent dependencies         |
 +---------------------------------------------------------------------+
```

**What happens during execution:**

```
  Wave 1  ->  Verify  ->  Review  ->  Fix  ->  Wave 2  ->  ...  ->  PR
    |            |           |          |
    |            |           |          +-- Fix agents spawn for accepted findings
    |            |           +-- Reviewer + builders reach consensus on issues
    |            +-- Types + lint + tests run automatically (self-healing loop)
    +-- Parallel builder agents execute independent tasks
```

The agent team architecture is skill-driven (defined in `/forge:go` markdown), not baked into the TypeScript codebase. This makes the orchestration pattern easy to modify.

### `npx forge run` -- Auto-Chain Execution

Run all remaining requirements for a project autonomously. The graph engine executes a requirement graph in topological order -- dependencies complete before dependents start. Each requirement gets a fresh Claude session in an isolated worktree with automatic verification and retry. On verification failure, the loop retries up to `maxIterations` times before stopping. Deadlock detection exits cleanly when circular dependencies prevent progress.

### `/forge:setup` and `/forge:update`

`/forge:setup` initializes a project: auto-detects your stack, creates `.forge.json`, installs skills and hooks, and scaffolds planning directories. `/forge:update` checks for newer forge-cc versions and upgrades.

---

## Verification Gates

Forge runs **3 verification gates** that catch issues before code ships:

```
 +----------+     +----------+     +----------+
 |  TYPES   |     |   LINT   |     |  TESTS   |
 |  tsc     |     |  biome   |     |  vitest/ |
 | --noEmit |     |  check   |     |  jest    |
 +----------+     +----------+     +----------+
```

| Gate | What it catches |
|------|----------------|
| **types** | Compilation errors, type mismatches (`tsc --noEmit`) |
| **lint** | Style violations, dead imports, code smells (`biome check`) |
| **tests** | Broken behavior, regressions (`vitest` or `jest`) |

Gates run sequentially with configurable per-gate timeouts (default 2 minutes each). Results are cached to `.forge/last-verify.json`.

**Self-healing:** When a gate fails during `forge run`, the errors are fed back to Claude as structured context -- file path, line number, error message. Claude fixes the issues and re-runs verification. This loops up to `maxIterations` (default 5) times before stopping. Most failures resolve automatically.

---

## Linear Integration

Forge manages your Linear project lifecycle end-to-end. Every state transition happens automatically as work progresses:

```
 Linear State:    Backlog  -->  Planned  -->  In Progress  -->  In Review  -->  Done
                     |             |               |                |              |
 Forge Action:    triage       /forge:spec      /forge:go       /forge:go       user merges,
                  creates      generates PRD,   starts           last milestone  runs
                  projects     syncs milestones milestone        completes       linear sync-done
```

State names are configurable via `linearStates` in `.forge.json` (default: "Planned", "In Progress", "In Review", "Done").

Set `LINEAR_API_KEY` in your environment to enable. Forge creates projects, milestones, and issues during spec, transitions them through states during execution, and marks them done when the user merges the PR.

---

## Branch & Worktree Management

You never touch git. Forge handles the entire branch lifecycle:

```
 main -----------------------------------------------------------> main (updated)
   |                                                                    ^
   +---> feat/my-project ---> worktree m1 ---> wave 1..N ---> merge ---+
                          |                                     |
                          +---> worktree m2 ---> (sequential)---+
```

**Worktree isolation** -- Each milestone runs in its own git worktree at `../.forge-wt/<repo>/<slug>-m<N>/`. Parallel agents within a wave share the worktree, but separate milestones get separate worktrees. Merges back to the feature branch use `--ff-only`.

**Minimal footprint** -- Worktree management is 3 functions (~50 lines): `createWorktree`, `mergeWorktree`, `removeWorktree`. No session registry, no parallel scheduler, no sessions.json.

**Automatic cleanup** -- When a milestone finishes (pass or fail), its worktree is removed. Protected branches (`main`, `master`) are never committed to directly.

---

## Quick Start

```bash
# 1. Install
npm install -g forge-cc

# 2. Set up your project
npx forge setup

# 3. (Optional) Set Linear API key for project management
export LINEAR_API_KEY="lin_api_..."

# 4. Start building
# /forge:triage  ->  /forge:spec  ->  /forge:go
```

`forge setup` auto-detects your stack (TypeScript, Biome, test runner), creates `.forge.json`, installs enforcement hooks, syncs skill files to `~/.claude/commands/forge/`, and updates your `CLAUDE.md`. Run `npx forge doctor` anytime to check your environment.

### Configuration

`.forge.json` in your project root:

```json
{
  "gates": ["types", "lint", "tests"],
  "maxIterations": 5,
  "linearTeam": "ENG"
}
```

<details>
<summary><b>Full configuration reference</b></summary>

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gates` | `string[]` | `["types", "lint", "tests"]` | Which verification gates to run |
| `gateTimeouts` | `Record<string, number>` | `{}` | Per-gate timeout in ms (default 120000 per gate) |
| `maxIterations` | `number` | `5` | Max retry iterations per requirement |
| `linearTeam` | `string` | `""` | Linear team key or name for lifecycle sync |
| `linearStates` | `object` | see below | Custom Linear state names |
| `verifyFreshness` | `number` | `600000` | Verify cache validity in ms (default 10 min) |
| `forgeVersion` | `string` | `"2.0.0"` | Version stamp from setup (used by version-check hook) |

**`linearStates` defaults:**

```json
{
  "planned": "Planned",
  "inProgress": "In Progress",
  "inReview": "In Review",
  "done": "Done"
}
```

**Environment:** Set `LINEAR_API_KEY` to enable Linear integration.

</details>

---

## CLI Reference

```bash
# Verification
npx forge verify                    # Run all configured gates
npx forge verify --gate types,lint  # Run specific gates
npx forge verify --json             # Output results as JSON

# Milestone execution
npx forge run --prd <slug>          # Auto-chain all milestones for a PRD

# Status
npx forge status                    # Show PRD progress across all projects

# Setup & maintenance
npx forge setup                     # Initialize forge for a project
npx forge setup --skills-only       # Only sync skill files
npx forge doctor                    # Environment health check
npx forge update                    # Check for and install updates

# Linear commands (used by skills, can also be called directly)
npx forge linear sync-start --slug <slug> --milestone <n>
npx forge linear sync-complete --slug <slug> --milestone <n> [--last]
npx forge linear sync-done --slug <slug>
npx forge linear list-issues --slug <slug>

# GitHub Codex
npx forge codex-poll --owner <owner> --repo <repo> --pr <number>  # Poll for Codex review
```

### Skill Commands

Skills are Claude Code slash commands installed to `~/.claude/commands/forge/`:

| Skill | Description |
|-------|-------------|
| `/forge:triage` | Brain dump to Linear projects -- extracts, deduplicates, creates |
| `/forge:spec` | Linear project to PRD with milestones -- scans codebase, interviews, generates |
| `/forge:go` | Execute milestones with wave-based agent teams -- build, verify, review, PR |
| `/forge:setup` | Run project scaffolding -- config, hooks, skills, CLAUDE.md |
| `/forge:update` | Check for updates and upgrade forge-cc |

### Enforcement Hooks

Forge installs two Claude Code hooks during setup:

- **Pre-commit hook** (`pre-commit-verify.js`) -- Blocks commits that haven't passed verification. Checks branch protection (no direct commits to main/master), verify cache freshness, and `result === 'PASSED'` in `.forge/last-verify.json`.
- **Version check hook** (`version-check.js`) -- Non-blocking notice when a newer forge-cc version is available or when project setup is stale.

### MCP Server

Expose the verification pipeline as an MCP tool for programmatic access:

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

**Tool:** `forge_run_pipeline`

| Input | Type | Description |
|-------|------|-------------|
| `projectDir` | `string?` | Project directory (defaults to cwd) |
| `gates` | `string[]?` | Filter to specific gates |

Returns the full pipeline result as JSON (result status, per-gate pass/fail, errors with file/line/message).

---

## How It's Different

| Without forge | With forge |
|--------------|-----------|
| Agent writes code, you review everything | Agent teams build, verify, review, and fix their own code |
| Manual git branching, PRs, merges | Automatic worktrees, branches, and PRs |
| "Tests pass" = done | 3 gates: types + lint + tests, with self-healing retry loop |
| One agent, one task, serial | Parallel agent teams with wave-based execution |
| Context rot across long sessions | Fresh session per milestone, no degradation |
| Linear updated manually | Automatic state transitions through your pipeline |

---

## Troubleshooting

<details>
<summary><b>Common issues</b></summary>

### `forge run` fails when invoked from within Claude Code

Forge strips the `CLAUDECODE` environment variable before spawning `claude` subprocesses. Claude Code uses this variable to detect nested sessions and blocks them. If `forge run` hangs or exits immediately, ensure you're running it from a terminal, not from inside an active Claude Code session. When invoked via the `/forge:go` skill, this is handled automatically.

### Pre-commit hook blocks commits

The pre-commit hook requires a passing verification cached in `.forge/last-verify.json`. Run `npx forge verify` to populate the cache. The cache expires after `verifyFreshness` ms (default 10 minutes).

### Linear sync runs but does nothing

If `forge linear sync-*` commands produce no output, check:
1. `LINEAR_API_KEY` is set in your environment
2. Your `.planning/status/<slug>.json` has `linearTeamId` and `linearProjectId` populated (these are set during `/forge:spec`)
3. Run `npx forge doctor` to validate the API key and team configuration

### `forge run` on Windows

On Windows, to locate the globally installed `forge-cc` package programmatically, use `process.env.APPDATA + '/npm/node_modules/forge-cc'`. Don't use bash path traversal -- backslash escaping breaks (the `\n` in `npm\node_modules` is interpreted as a newline).

### Doctor says checks failed

Run `npx forge doctor` to see which checks fail. Required: Node.js >= 18 and git. Optional: `gh` CLI (for PR workflows), `LINEAR_API_KEY` (for Linear integration).

</details>

---

<details>
<summary><h2>Architecture & Contributor Reference</h2></summary>

### Project Structure

```
forge-cc/
  src/
    cli.ts              # CLI entry (npx forge)
    codex-poll.ts       # GitHub Codex PR review polling
    types.ts            # Core types
    doctor.ts           # Environment health checks
    setup.ts            # Project scaffolding
    config/
      loader.ts         # .forge.json reader + auto-detection
      schema.ts         # Zod schema for .forge.json
    gates/
      index.ts          # Gate registry + pipeline runner
      types-gate.ts     # TypeScript gate (tsc --noEmit)
      lint-gate.ts      # Lint gate (biome check)
      tests-gate.ts     # Tests gate (vitest/jest)
    graph/
      types.ts          # Graph types (GraphIndex, Requirement, etc.)
      schemas.ts        # Zod schemas for graph YAML
      reader.ts         # Load index, requirements, overview from disk
      writer.ts         # Atomic writes for index, requirements, overview
      query.ts          # findReady, findBlocked, getTransitiveDeps, computeWaves
      validator.ts      # Structural validation (cycles, dangling deps, conflicts)
      index.ts          # Public re-exports
    linear/
      client.ts         # @linear/sdk wrapper (team-scoped, category+name fallback)
      sync.ts           # Linear state transitions
    runner/
      loop.ts           # Graph loop executor
      prompt.ts         # Prompt builder + requirement context
      update.ts         # Version check
    state/
      cache.ts          # Verify cache writer
    worktree/
      manager.ts        # createWorktree, mergeWorktree, removeWorktree
  skills/               # Claude Code skill definitions (markdown)
  hooks/                # Installable hooks (pre-commit, version-check)
  tests/                # Test suite (vitest)
```

### Design Decisions

**Skill-driven orchestration.** The agent team architecture (executive, reviewer, builders, notetaker) is defined in skill markdown files, not in TypeScript. This means the orchestration pattern can be modified by editing a markdown file -- no code changes, no builds.

**File system as memory.** Milestones communicate through `.planning/status/<slug>.json` files and the PRD itself. No in-memory state is passed between milestones. This enables the "fresh process per milestone" pattern that avoids context degradation.

**Minimal worktree management.** Three functions, ~50 lines. No session registry, no parallel DAG scheduler. Worktrees are created at `../.forge-wt/<repo>/<slug>-m<N>/` and cleaned up after each milestone.

**Gate pipeline, not gate tree.** Gates run sequentially, not in parallel. This is intentional -- types must pass before lint makes sense, lint before tests. Per-gate timeouts (default 2 minutes) prevent hangs.

### Extension Points

**Adding a gate:** Create a new file in `src/gates/` implementing the `Gate` interface (`name: string`, `run: (projectDir: string) => Promise<GateResult>`). Register it in `src/cli.ts` and `src/server.ts` with `registerGate()`.

**Custom Linear states:** Override the default state names in `.forge.json`:

```json
{
  "linearStates": {
    "planned": "Todo",
    "inProgress": "Doing",
    "inReview": "Review",
    "done": "Complete"
  }
}
```

**Custom gate timeouts:** Set per-gate timeouts in milliseconds:

```json
{
  "gateTimeouts": {
    "tests": 300000
  }
}
```

### Key Lessons Learned

These lessons were learned during forge-cc's own development and are baked into the workflow:

- **Milestone sizing matters.** Every milestone must be completable in one agent context window. If it's too large, split it. The `/forge:spec` skill enforces this.
- **No compaction chaining.** Never rely on Claude Code's context compaction for multi-milestone execution. Fresh processes per milestone (via `forge run`) are the correct pattern -- the file system is the only memory between iterations.
- **Restage at wave boundaries.** Parallel builder agents can disrupt each other's git index. Restage all files at wave boundaries.
- **Verify between waves.** Run `tsc --noEmit` between every wave, not just at the end. Catches cross-agent integration issues early.
- **Silent failure is a bug.** CLI commands that touch external systems must print what they did or why they skipped. No-output-as-success is not acceptable.

### Development

```bash
npm install          # Dependencies
npm run build        # Build
npm test             # Tests
npx tsc --noEmit     # Type check
npx forge verify     # Self-verify
```

**Stack:** TypeScript (ES2022 strict), Node.js 18+, MCP SDK, Commander, Zod, Vitest

</details>

---

<p align="center">
  <sub>MIT License &bull; Built for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a></sub>
</p>
