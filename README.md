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

forge-cc is a Claude Code plugin that turns your AI coding agent into an autonomous development team. You describe what you want to build. Forge breaks it into milestones, spins up parallel agent teams, verifies every line of code, creates the PR, gets it reviewed, and merges it -- all without you touching git.

```
npm install -g forge-cc
```

---

## The Workflow

Four commands take you from raw idea to production-ready, merged code.

```
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                  │
 │   YOU HAVE AN IDEA            FORGE DOES THE REST                                │
 │                                                                                  │
 │   "We need auth,        ┌────────────┐  ┌────────────┐  ┌────────────┐          │
 │    a dashboard,         │            │  │            │  │            │          │
 │    and email            │  TRIAGE    ├──►   SPEC     ├──►    GO      │          │
 │    notifications"       │            │  │            │  │            │          │
 │                         └─────┬──────┘  └─────┬──────┘  └─────┬──────┘          │
 │                               │               │               │                 │
 │                         Creates Linear   Scans codebase   Agent teams            │
 │                         projects from    + interviews     build each             │
 │                         brain dump       you + generates  milestone              │
 │                                          PRD + milestones in parallel            │
 │                                                               │                 │
 │                                                               ▼                 │
 │                                                     ┌────────────────┐          │
 │                                                     │  VERIFY + PR   │          │
 │                                                     │  + CODE REVIEW │          │
 │                                                     └────────────────┘          │
 │                                                                                  │
 └──────────────────────────────────────────────────────────────────────────────────┘
```

### `/forge:triage` -- Brain Dump to Backlog

Paste sticky notes, Slack messages, or stream-of-consciousness feature ideas. Forge extracts distinct projects, deduplicates against your existing Linear backlog, and creates them after your confirmation.

### `/forge:spec` -- Project to PRD

Pick a project from Linear. Forge scans your codebase in parallel (structure, routes, dependencies, patterns), then conducts an adaptive interview -- leading with recommendations based on what it found, not blank-slate questions. The output is a full PRD with milestones sized to fit agent context windows, synced back to Linear with issues and status tracking.

### `/forge:go` -- Milestones to Merged Code

This is the engine. Each milestone is executed by an autonomous agent team:

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  EXECUTIVE  (orchestrator)                                         │
 │  Plans waves, assigns tasks, resolves escalations                  │
 ├─────────────────────────────────────────────────────────────────────┤
 │  REVIEWER  (persistent across all waves)                           │
 │  Reviews diff against PRD after each wave                          │
 │  Findings go through consensus protocol with builders              │
 ├────────────────────┬────────────────────┬───────────────────────────┤
 │  BUILDER 1         │  BUILDER 2         │  BUILDER N ...            │
 │  Parallel agents   │  Parallel agents   │  Each gets a task,        │
 │  within each wave  │  within each wave  │  writes + tests code      │
 └────────────────────┴────────────────────┴───────────────────────────┘
```

**What happens during execution:**

```
  Wave 1  ─►  Verify  ─►  Review  ─►  Fix  ─►  Wave 2  ─►  ...  ─►  PR  ─►  Merge
    │            │           │          │
    │            │           │          └─ Fix agents spawn for accepted findings
    │            │           └─ Reviewer + builders reach consensus on issues
    │            └─ Types + lint + tests run automatically (self-healing loop)
    └─ Parallel builder agents execute independent tasks
```

After the final wave passes all gates + review, forge creates the PR, waits for Codex review comments, and spawns fix agents for any findings. The PR is left for the user to merge.

### `npx forge run` -- Auto-Chain Everything

Run all remaining milestones autonomously. Each gets a fresh Claude session (no context rot), with stall detection that stops on failure. Independent milestones run in parallel.

---

## Verification Gates

Not just "run tests." Forge runs **8 verification gates** that catch what tests alone can't:

```
 ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
 │  TYPES   │  │   LINT   │  │  TESTS   │  │  VISUAL  │
 │ tsc      │  │ biome    │  │ vitest/  │  │ 3-viewport│
 │ --noEmit │  │ check    │  │ jest     │  │ screenshots│
 └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
      │              │              │              │
      ▼              ▼              ▼              ▼
 ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
 │ RUNTIME  │  │   PRD    │  │  REVIEW  │  │  CODEX   │
 │ endpoint │  │ acceptance│  │ AI code  │  │ post-PR  │
 │ checks   │  │ criteria │  │ review   │  │ review   │
 └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

| Gate | What it catches |
|------|----------------|
| **types** | Compilation errors, type mismatches |
| **lint** | Style violations, dead imports, code smells |
| **tests** | Broken behavior, regressions |
| **visual** | UI regressions across desktop, tablet, and mobile viewports |
| **runtime** | Crashed endpoints, wrong status codes, malformed responses |
| **prd** | Missing features, acceptance criteria drift |
| **review** | Logic errors, missing edge cases, architectural issues |
| **codex** | Post-PR findings from GitHub's Codex reviewer |

**Self-healing:** When a gate fails, forge parses the errors into structured remediation (file, line, message, fix hint) and spawns a fix agent. This loops up to 5 times before stopping -- most failures resolve automatically.

---

## Linear Integration

Forge manages your Linear project lifecycle end-to-end. Every state transition happens automatically as work progresses:

```
 Linear State:    Backlog  ──►  Planned  ──►  In Progress  ──►  In Review  ──►  Done
                     │             │               │                │              │
 Forge Action:    triage       /forge:spec      /forge:go       PR created     user merges
                  creates      generates PRD,   executes        after final    when ready
                  projects     syncs milestones milestone       verification
```

Set `FORGE_LINEAR_API_KEY` in your environment to enable. Forge creates projects, milestones, and issues during spec, transitions them through states during execution, and marks them done when the PR merges.

---

## Branch & Worktree Management

You never touch git. Forge handles the entire branch lifecycle:

```
 main ─────────────────────────────────────────────────────► main (updated)
   │                                                            ▲
   └──► feat/auth ──► worktree 1 ──► wave 1..N ──► PR ──► merge + cleanup
   │                                                 │
   └──► feat/dashboard ──► worktree 2 ──► (parallel) ┘
```

**Session isolation** -- Each milestone runs in its own git worktree (`../.forge-wt/<repo>/<session>/`). Parallel agents can't corrupt each other's git index. Multiple milestones can execute simultaneously on the same repo.

**Automatic cleanup** -- When a milestone finishes, its worktree and branch are deleted. When a PR merges, `npx forge cleanup` prunes the local branch. Crashed sessions are detected by PID and cleaned up. Protected branches (`main`, `master`) are never touched.

**Cross-platform** -- Windows path limits handled with 8-char hex session IDs. Atomic file writes use retry-on-rename for Windows file locking.

---

## Quick Start

```bash
# 1. Install
npm install -g forge-cc

# 2. Set up your project
npx forge setup

# 3. Start building
# /forge:triage  →  /forge:spec  →  /forge:go
```

`forge setup` auto-detects your stack (TypeScript, Biome, test runner), creates `.forge.json`, installs enforcement hooks, and scaffolds planning directories. Run `npx forge doctor` anytime to check your environment.

### Configuration

`.forge.json` in your project root:

```json
{
  "gates": ["types", "lint", "tests"],
  "maxIterations": 5,
  "linearProject": "My Project"
}
```

<details>
<summary><b>Full configuration options</b></summary>

| Option | Default | Description |
|--------|---------|-------------|
| `gates` | `["types","lint","tests"]` | Which verification gates to run |
| `maxIterations` | `5` | Max self-healing retry loops |
| `verifyFreshness` | `600000` | Cache validity (ms, default 10min) |
| `devServer.command` | -- | Start command for visual/runtime gates |
| `devServer.port` | -- | Dev server port |
| `devServer.readyPattern` | -- | Stdout pattern for server ready |
| `prdPath` | -- | PRD path for acceptance criteria gate |
| `linearProject` | -- | Linear project name for lifecycle sync |
| `review.blocking` | `false` | Whether review findings block the pipeline |

**Environment:** Set `FORGE_LINEAR_API_KEY` to enable Linear integration.

</details>

### CLI

```bash
npx forge verify              # Run all gates
npx forge verify --gate types # Run specific gates
npx forge status              # Branch, config, last verification
npx forge doctor              # Environment health check
npx forge cleanup             # Prune stale worktrees + branches
npx forge run                 # Auto-chain all milestones
```

### Enforcement Hooks

Forge installs two Claude Code hooks automatically during setup:

- **Pre-commit hook** -- Blocks commits that haven't passed verification. Checks branch protection, cache freshness, and gate results.
- **Version check hook** -- Non-blocking notice when a newer forge-cc version is available.

### MCP Server

Expose gates as MCP tools for programmatic access:

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

---

## How It's Different

| Without forge | With forge |
|--------------|-----------|
| Agent writes code, you review everything | Agent teams build, verify, review, and fix their own code |
| Manual git branching, PRs, merges | Automatic branches, worktrees, and PRs |
| "Tests pass" = done | 8 gates including visual regression, PRD compliance, and AI code review |
| One agent, one task, serial | Parallel agent teams with wave-based execution |
| Context rot across long sessions | Fresh session per milestone, no degradation |
| Linear updated manually | Bidirectional sync -- forge moves issues through your pipeline |

---

<details>
<summary><h2>Agent & Contributor Reference</h2></summary>

### Project Structure

```
forge-cc/
  src/
    cli.ts              # CLI entry (npx forge)
    server.ts           # MCP server (stdio transport)
    types.ts            # Core types
    gates/              # Verification gates + remediation
    config/             # .forge.json schema + auto-detection
    linear/             # Linear API client + lifecycle
    hooks/              # Pre-commit enforcement
    reporter/           # Human + JSON output formatting
    state/              # Session state reader/writer
    spec/               # Spec engine (scanner, interview, generator)
    go/                 # Execution engine (verify loop, auto-chain, finalize)
    setup/              # Project scaffolding templates
    worktree/           # Worktree manager, session registry, state merge
    utils/              # Platform utilities (atomic writes, paths)
  skills/               # Claude Code skill definitions
  hooks/                # Installable hook files
  tests/                # Test suite (vitest)
```

### Development

```bash
npm install          # Dependencies
npm run build        # Build
npm test             # Tests
npm run dev          # Watch mode
npx forge verify     # Self-verify
```

**Stack:** TypeScript (ES2022 strict), Node.js 18+, MCP SDK, Commander, Playwright, Zod, Vitest

### Agent Team Architecture

During `/forge:go`, forge creates a 3-tier agent team:

- **Executive** -- The orchestrator. Plans waves, assigns tasks, manages state, resolves deadlocks.
- **Reviewer** -- Persistent Opus agent. Examines diff after each wave against PRD acceptance criteria. Sends structured findings (file/line/message/remediation). Participates in consensus protocol with builders.
- **Builders** -- Parallel Opus agents, one per task. Full-capability (file editing, git, shell). Can spawn subagents for research. Stage only their files.
- **Notetaker** -- Optional, spawned for 3+ waves or 4+ agents per wave. Tracks decisions, file ownership, cross-agent dependencies.

**Consensus protocol:** Reviewer sends findings to builders. Builders respond agree/disagree/propose alternative. Up to 2 rounds of back-and-forth. Deadlocks escalate to executive.

### Gate Pipeline Details

Gates run in configured order. If all core gates (types, lint, tests) fail, remaining gates are skipped. Each gate has a 2-minute timeout. Results are cached per-branch to `.forge/verify-cache/<branch>.json`.

The self-healing loop parses failures into structured remediation templates -- each error includes file path, line number, error message, and a specific fix hint. Fix agents receive only the errors to fix, keeping context minimal and focused.

### Worktree Internals

Each session creates a worktree at `../.forge-wt/<repo>/<session-id>/` branching from the feature branch. Active sessions are tracked in `.forge/sessions.json`. On completion, the worktree branch merges back to the feature branch, then the worktree and its branch are deleted.

The parallel scheduler analyzes milestone `dependsOn` fields, builds a DAG, detects cycles, and groups independent milestones into parallel waves that execute simultaneously in separate worktrees.

</details>

---

<p align="center">
  <sub>MIT License &bull; Built for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a></sub>
</p>
