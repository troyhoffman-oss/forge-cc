<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/forge--cc-Autonomous_Dev_Workflow-white?style=for-the-badge&labelColor=000000" />
    <img src="https://img.shields.io/badge/forge--cc-Autonomous_Dev_Workflow-000000?style=for-the-badge&labelColor=white" alt="forge-cc" />
  </picture>
</p>

<p align="center">
  <strong>Idea to merged PR. Graph-driven execution. Adversarial review. Zero manual git.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/forge-cc"><img src="https://img.shields.io/npm/v/forge-cc?style=flat-square&color=0969da" alt="npm" /></a>
  <img src="https://img.shields.io/badge/Claude_Code-plugin-7c3aed?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkw0IDdWMTdMMTIgMjJMMjAgMTdWN0wxMiAyWiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=&logoColor=white" alt="Claude Code" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="node" />
  <img src="https://img.shields.io/npm/l/forge-cc?style=flat-square&color=22863a" alt="MIT" />
</p>

---

## What is forge-cc?

forge-cc is a Claude Code plugin that turns your AI coding agent into an autonomous development pipeline. You describe what you want. Forge decomposes it into a dependency graph of requirements, executes each one in an isolated worktree with adversarial review, runs self-healing verification, syncs state to Linear, and creates the PR -- all without you touching git.

```
npm install -g forge-cc
```

---

## The Workflow

Seven skill commands cover the full lifecycle from raw idea to production-ready code.

```
 +-----------------------------------------------------------------------------------+
 |                                                                                   |
 |   YOU HAVE AN IDEA            FORGE DOES THE REST                                 |
 |                                                                                   |
 |   "We need auth,        +-----------+  +-----------+  +-----------+               |
 |    a dashboard,         |           |  |           |  |           |               |
 |    and email            |  CAPTURE  +--->   PLAN   +--->  BUILD   |               |
 |    notifications"       |           |  |           |  |           |               |
 |                         +-----+-----+  +-----+-----+  +-----+-----+              |
 |                               |              |              |                     |
 |                         Creates Linear   Scans codebase   Executes graph          |
 |                         projects from    + interviews     with adversarial        |
 |                         brain dump       you + generates  review per              |
 |                                          requirement      requirement             |
 |                                          graph                |                   |
 |                                                               v                   |
 |                                                     +----------------+            |
 |                                                     |  VERIFY + PR   |            |
 |                                                     +----------------+            |
 |                                                                                   |
 +-----------------------------------------------------------------------------------+
```

### `/forge:capture` -- Brain Dump to Backlog

Paste sticky notes, Slack messages, or stream-of-consciousness feature ideas. Forge extracts distinct projects, deduplicates against your existing Linear backlog, and creates them after your confirmation. Projects are created at "Planned" state.

### `/forge:plan` -- Interview to Requirement Graph

Pick a project. Forge scans your codebase in parallel (structure, routes, dependencies, patterns), then conducts an adaptive interview -- leading with recommendations based on what it found, not blank-slate questions. The output is a requirement graph at `.planning/graph/{slug}/` with:

- **`_index.yaml`** -- Project metadata, requirement registry (id, status, group, dependencies, priority), group definitions
- **`overview.md`** -- Project overview and architectural decisions
- **`requirements/req-NNN.md`** -- Individual requirements with YAML frontmatter (files, acceptance criteria, dependencies)

Requirements are sized with hard limits (max 6 acceptance criteria, max 5 files touched) and validated with `detectCycles()` and `computeWaves()` before committing.

### `/forge:build` -- Execute Graph with Adversarial Review

This is the engine. Each requirement is executed sequentially in dependency order:

```
 Load graph
   |
   v
 findReady() ─── picks next requirement (pending + all deps complete)
   |
   v
 ┌─────────────────────────────────────────────────────┐
 │  Per requirement (isolated worktree):               │
 │                                                     │
 │  Create worktree ──> Build ──> Verify ──> Review    │
 │       │                          │          │       │
 │       │                     Self-healing    │       │
 │       │                     loop (max 3)   Pass?    │
 │       │                                     │       │
 │       │                              Yes: merge     │
 │       │                              No:  retry     │
 │       │                                             │
 │  Cleanup worktree                                   │
 └─────────────────────────────────────────────────────┘
   |
   v
 Next ready requirement... until graph complete
```

**How it works:**

1. `findReady()` selects the next requirement -- pending status, all dependencies complete, sorted by priority then group order then insertion order
2. A fresh git worktree is created at `../.forge-wt/<repo>/<slug>-<reqId>/`
3. Claude builds the requirement with attention-aware prompting (overview → dependency context → target requirement loaded last)
4. Verification gates run (types, lint, tests) with self-healing -- errors are fed back as structured context
5. An adversarial reviewer checks the actual files on disk (not diffs) against acceptance criteria
6. On pass: merge worktree back to feature branch, mark requirement complete, sync to Linear
7. On fail: retry up to 3 iterations before stopping

### `/forge:fix` -- Surgical Recovery

When a requirement fails during build, `/forge:fix` provides targeted recovery. Select the failed requirement, diagnose the issue, and fix it in isolation with up to 3 repair iterations. Minimal changes only -- no scope creep.

### `/forge:quick` -- Ad-Hoc Tasks

For tasks that don't need a requirement graph. Creates a branch (`feat/quick-*` or `fix/quick-*`), builds directly, runs verification, and creates the PR. No planning ceremony, no adversarial review.

### `/forge:setup` and `/forge:update`

`/forge:setup` initializes a project: auto-detects your stack, creates `.forge.json`, installs skills and hooks, scaffolds planning directories, and runs diagnostics. `/forge:update` checks for newer forge-cc versions and upgrades.

---

## The Graph Engine

Forge's core is a requirement graph engine that models your project as a directed acyclic graph (DAG) of requirements.

### Requirement Lifecycle

```
 pending ──> in_progress ──> complete
                |
                +──> (retry on verify/review failure, up to maxIterations)

 discovered ──> pending  (human-gated: new requirements found during build)
 discovered ──> rejected (user declines the discovered requirement)
```

### Key Functions

| Function | What it does |
|----------|-------------|
| `findReady()` | Returns requirements where status is `pending`, all `dependsOn` are `complete`, and group dependencies are satisfied. Sorted by priority → group order → insertion order. |
| `computeWaves()` | Groups ready requirements into parallel-safe waves with no file conflicts. Used during planning to preview execution order. |
| `getTransitiveDeps()` | DFS traversal returning all transitive dependencies. Throws on cycle detection. |
| `isProjectComplete()` | True when every non-rejected requirement has status `complete`. |
| `buildRequirementContext()` | Assembles dependency context for a requirement -- transitive deps in topological order with their status and file artifacts. |

### Graph Files

```
.planning/graph/{slug}/
  _index.yaml          # Project metadata + requirement registry
  overview.md          # Architecture decisions, scope, constraints
  requirements/
    req-001.md         # Requirement with YAML frontmatter
    req-002.md         # (id, title, files, acceptance, dependsOn)
    ...
```

The index tracks each requirement's `status`, `group`, `dependsOn`, `priority`, and optional `linearIssueId`. Groups define execution phases with their own dependency ordering.

---

## Adversarial Review

Every requirement built by `/forge:build` goes through adversarial review before merge. The reviewer is a separate Claude session that reads the actual files on disk -- not diffs, not summaries.

**What the reviewer checks:**

- **Stub detection** -- Empty function bodies, TODO comments, hardcoded return values, placeholder implementations
- **Acceptance criteria** -- Every criterion in the requirement must be demonstrably met
- **File scope** -- Created files exist, modified files are relevant, no out-of-scope changes
- **Technical approach** -- Architecture matches the overview, no security vulnerabilities

**Output format:** Each finding is tagged `[PASS]`, `[FAIL]`, or `[WARN]` with `file:line` references. No partial credit -- a single `[FAIL]` finding fails the entire review.

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

**Self-healing:** When a gate fails during `forge run` or `/forge:build`, the errors are fed back to Claude as structured context -- file path, line number, error message. Claude fixes the issues and re-runs verification. This loops up to `maxIterations` (default 5) before stopping. Most failures resolve automatically.

---

## Linear Integration

Forge manages your Linear project lifecycle end-to-end. State transitions happen automatically as work progresses through the graph:

```
 Linear State:    Backlog  -->  Planned  -->  In Progress  -->  Done
                     |             |               |              |
 Forge Action:    /forge:       /forge:plan      /forge:build    all requirements
                  capture       syncs issues     starts each     complete,
                  creates       to Linear        requirement     project synced
                  projects                                       to Done
```

- `syncRequirementStart()` -- Moves the issue to "In Progress" and the project to "In Progress" (best-effort, never crashes on API errors)
- `syncGraphProjectDone()` -- Moves all issues to "Done" and the project to "Done"

State names are configurable via `linearStates` in `.forge.json`. The Linear client uses category-based status resolution with name-based fallback -- it works with custom workflow states out of the box.

Set `LINEAR_API_KEY` in your environment to enable.

---

## Worktree Isolation

Every requirement executes in its own git worktree. You never touch git.

```
 main ──────────────────────────────────────────────> main (updated)
   |                                                       ^
   +──> feat/my-project ──> worktree req-001 ──> merge ──>─+
                         |                          |
                         +──> worktree req-002 ──>──+
                         |         (sequential)
                         +──> worktree req-003 ──>──+
```

**Isolation** -- Each requirement gets its own worktree at `../.forge-wt/<repo>/<slug>-<reqId>/`. The build agent operates in a clean copy of the repository, preventing cross-requirement interference.

**Minimal footprint** -- Worktree management is 3 functions: `createWorktree` (git worktree add -b), `mergeWorktree` (checkout + merge --ff-only), `removeWorktree` (git worktree remove --force). No session registry, no parallel scheduler.

**Automatic cleanup** -- When a requirement finishes (pass or fail), its worktree is removed. Protected branches (`main`, `master`) are never committed to directly.

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
# /forge:capture  ->  /forge:plan  ->  /forge:build
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

# Graph execution
npx forge run --prd <slug>          # Execute all requirements for a graph

# Status
npx forge status                    # Show project progress across all graphs

# Setup & maintenance
npx forge setup                     # Initialize forge for a project
npx forge setup --skills-only       # Only sync skill files
npx forge doctor                    # Environment health check
npx forge update                    # Check for and install updates

# Linear commands
npx forge linear create-project --name <name> --team <teamId>
npx forge linear create-milestone --project <id> --name <name>
npx forge linear create-issue --team <teamId> --title <title> [--project <id>] [--milestone <id>]
npx forge linear create-issue-batch --team <teamId> --project <id> --milestone <id> --issues '<json>'
npx forge linear create-project-relation --project <id> --related-project <id> --type <blocks|related>
npx forge linear create-issue-relation --issue <id> --related-issue <id> --type <blocks|duplicate|related>
npx forge linear list-teams
npx forge linear list-projects --team <teamId>

# GitHub Codex
npx forge codex-poll --owner <owner> --repo <repo> --pr <number>
```

### Skill Commands

Skills are Claude Code slash commands installed to `~/.claude/commands/forge/`:

| Skill | Description |
|-------|-------------|
| `/forge:capture` | Brain dump to Linear projects -- extracts, deduplicates, creates |
| `/forge:plan` | Codebase scan + adaptive interview → requirement graph with dependency DAG |
| `/forge:build` | Execute requirement graph -- worktree isolation, adversarial review, self-healing verify |
| `/forge:fix` | Surgical recovery for failed requirements -- diagnose, repair, re-verify |
| `/forge:quick` | Ad-hoc tasks without planning ceremony -- branch, build, verify, PR |
| `/forge:setup` | Initialize project scaffolding -- config, hooks, skills, CLAUDE.md |
| `/forge:update` | Check for updates and upgrade forge-cc |

### Enforcement Hooks

Forge installs two Claude Code hooks during setup:

- **Pre-commit hook** (`pre-commit-verify.js`) -- Blocks commits that haven't passed verification. Checks branch protection (no direct commits to main/master), verify cache freshness, and `result === 'PASSED'` in `.forge/last-verify.json`.
- **Version check hook** (`version-check.js`) -- Non-blocking notice when a newer forge-cc version is available or when project setup is stale.

---

## How It's Different

| Without forge | With forge |
|--------------|-----------|
| Agent writes code, you review everything | Graph-driven execution with adversarial review catches issues before you see them |
| Manual git branching, PRs, merges | Automatic worktrees per requirement, branches, and PRs |
| "Tests pass" = done | 3 gates (types + lint + tests) with self-healing retry loop |
| One agent, one task, serial | Dependency-aware execution with topological ordering |
| Context rot across long sessions | Fresh session per requirement, file system is the only memory |
| Linear updated manually | Automatic state transitions through your pipeline |
| Failed builds need manual triage | `/forge:fix` provides surgical recovery with targeted diagnosis |

---

## Troubleshooting

<details>
<summary><b>Common issues</b></summary>

### `forge run` fails when invoked from within Claude Code

Forge strips the `CLAUDECODE` environment variable before spawning `claude` subprocesses. Claude Code uses this variable to detect nested sessions and blocks them. If `forge run` hangs or exits immediately, ensure you're running it from a terminal, not from inside an active Claude Code session. When invoked via the `/forge:build` skill, this is handled automatically.

### Pre-commit hook blocks commits

The pre-commit hook requires a passing verification cached in `.forge/last-verify.json`. Run `npx forge verify` to populate the cache. The cache expires after `verifyFreshness` ms (default 10 minutes).

### Linear sync runs but does nothing

Check:
1. `LINEAR_API_KEY` is set in your environment
2. Your graph's `_index.yaml` has `linear.projectId` and `linear.teamId` populated (set during `/forge:plan`)
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
      types.ts          # Graph types (GraphIndex, Requirement, RequirementMeta)
      schemas.ts        # Zod schemas for graph YAML
      reader.ts         # Load index, requirements, overview from disk
      writer.ts         # Atomic writes for index, requirements, overview
      query.ts          # findReady, computeWaves, getTransitiveDeps, isProjectComplete
      validator.ts      # Structural validation (cycles, dangling deps, file conflicts)
      index.ts          # Public re-exports
    linear/
      client.ts         # @linear/sdk wrapper (team-scoped, category+name fallback)
      sync.ts           # Linear state transitions (syncRequirementStart, syncGraphProjectDone)
    runner/
      loop.ts           # Graph loop executor (sequential requirement execution)
      prompt.ts         # Prompt builder (attention-aware requirement context)
      update.ts         # Version check
    state/
      cache.ts          # Verify cache writer
    worktree/
      manager.ts        # createWorktree, mergeWorktree, removeWorktree
  skills/               # Claude Code skill definitions (markdown)
    ref/                # Reference docs (adversarial-review, requirement-sizing, graph-correction)
  hooks/                # Installable hooks (pre-commit, version-check)
  tests/                # Test suite (vitest)
```

### Design Decisions

**Graph-driven execution.** Projects are modeled as a DAG of requirements with explicit dependencies. `findReady()` acts as a scheduler, selecting the next executable requirement based on dependency completion, priority, and group ordering. This replaces the earlier milestone/wave architecture with a more granular model that naturally handles partial failures and incremental progress.

**Skill-driven orchestration.** The build workflow (adversarial review, discovery flow, retry logic) is defined in skill markdown files, not in TypeScript. The graph engine provides the execution loop and scheduling; the skill files define how each requirement is actually built and reviewed. This separation means orchestration patterns can be modified by editing markdown -- no code changes, no builds.

**File system as memory.** Requirements communicate through `.planning/graph/{slug}/` files on disk. No in-memory state passes between requirements. Each requirement gets a fresh Claude session, which avoids context degradation over long projects. The graph index is the single source of truth for project state.

**Atomic writes.** All graph mutations (status updates, new requirements, index changes) use crash-safe writes: write to a temp file, then rename. Index is written first so that a crash between index and requirement file writes leaves the system in a recoverable state.

**Attention-aware prompting.** When building a requirement, the prompt loads context in a specific order: project overview → dependency artifacts → target requirement. The target requirement is loaded last to exploit recency bias in the model's attention, keeping acceptance criteria and file scope front of mind.

**Human-gated discovery.** When a build agent discovers that additional requirements are needed, they are created with `discovered` status. These must be explicitly approved by the user before entering the execution queue. This prevents unbounded scope expansion while still capturing emergent work.

**Sequential execution, parallel-safe design.** Requirements execute one at a time in the current implementation, but the graph engine's `computeWaves()` function can identify parallel-safe groups. The architecture supports future parallel execution without structural changes.

**Gate pipeline, not gate tree.** Gates run sequentially, not in parallel. This is intentional -- types must pass before lint makes sense, lint before tests. Per-gate timeouts (default 2 minutes) prevent hangs.

### Extension Points

**Adding a gate:** Create a new file in `src/gates/` implementing the `Gate` interface (`name: string`, `run: (projectDir: string) => Promise<GateResult>`). Register it in `src/gates/index.ts` with `registerGate()`.

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

### Development

```bash
npm install          # Dependencies
npm run build        # Build
npm test             # Tests
npx tsc --noEmit     # Type check
npx forge verify     # Self-verify
```

**Stack:** TypeScript (ES2022 strict), Node.js 18+, Commander, Zod, Vitest

</details>

---

<p align="center">
  <sub>MIT License &bull; Built for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a></sub>
</p>
