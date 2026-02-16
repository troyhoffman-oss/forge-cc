<p align="center">
  <img src="https://img.shields.io/npm/v/forge-cc?style=flat-square&color=0969da" alt="npm version" />
  <img src="https://img.shields.io/npm/l/forge-cc?style=flat-square&color=22863a" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="node version" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="typescript strict" />
  <img src="https://img.shields.io/badge/Claude_Code-ready-7c3aed?style=flat-square" alt="Claude Code ready" />
</p>

# forge-cc

**The development workflow engine for Claude Code agents.**

forge-cc gives AI coding agents the same guardrails a senior engineering team enforces: type safety, linting, test coverage, visual regression, PRD compliance, and code review -- all verified automatically before code ever hits a PR. Combined with workflow skills that manage the entire lifecycle from idea to merged code, forge-cc turns Claude Code into a self-verifying, project-aware development partner.

---

## Why forge-cc?

AI coding agents write code fast, but speed without quality gates means you spend more time reviewing than you save. forge-cc solves this by:

- **Catching errors before commit** -- TypeScript, linting, tests, visual regressions, and PRD compliance checks run automatically, so agents self-correct before you see the code.
- **Enforcing standards mechanically** -- Pre-commit hooks and Claude Code hooks block unverified commits. No discipline required; the machine enforces it.
- **Managing the full lifecycle** -- From triaging ideas into Linear to generating PRDs to executing milestones with parallel agent teams, forge-cc handles the project management plumbing so you focus on decisions.
- **Isolating concurrent work** -- Multiple agents can work on different milestones simultaneously using git worktrees with automatic state merging.

---

## Prerequisites

| Dependency | Required? | Purpose |
|------------|-----------|---------|
| **Node.js 18+** | Required | Runtime for forge-cc and all gates |
| **git** | Required | Version control, worktree isolation |
| **GitHub CLI (`gh`)** | Recommended | PR creation, Linear integration, codex review gate |
| **Playwright + Chromium** | Optional | `visual` and `runtime` gates (screenshot comparison, endpoint validation) |

Run `npx forge doctor` to check your environment at any time.

---

## Quick Start

```bash
# Install globally
npm install -g forge-cc
```

On install, you'll see a summary of what's ready:

```
  forge-cc v0.1.12 installed
    ✓ Skills synced to ~/.claude/commands/forge/
    ✗ Playwright (visual + runtime gates): not installed
      → Run: npm install -g playwright && npx playwright install chromium

  Get started: forge setup
```

```bash
# Initialize your project
npx forge setup

# Check your environment
npx forge doctor

# Run verification
npx forge verify

# Check status
npx forge status
```

Or install as a dev dependency:

```bash
npm install --save-dev forge-cc
```

On first run with no `.forge.json`, forge auto-detects gates from your `package.json`:

| Detected | Gate Enabled |
|----------|-------------|
| `typescript` in dependencies | **types** -- `tsc --noEmit` |
| `@biomejs/biome` in dependencies | **lint** -- `biome check` |
| `test` script in package.json | **tests** -- `npm test` |

---

## Workflow Overview

forge-cc manages the complete development lifecycle through five workflow skills. Here's how a typical project flows from idea to merged PR:

```
  Brain dump           PRD with              Code built &          Merged
  or idea              milestones            verified              to main
     |                    |                     |                    |
     v                    v                     v                    v
/forge:triage  -->  /forge:spec  -->  /forge:go  -->  PR Review  -->  Done
     |                    |                     |
     v                    v                     v
  Linear projects     Codebase scan         Wave-based agent
  created in          + interview +         teams execute each
  Backlog             PRD generation        milestone with
                      + Linear sync         verification gates
```

### Step 1: Triage Ideas (`/forge:triage`)

Paste unstructured notes, feature requests, or brainstorms. The skill extracts distinct projects, deduplicates against your existing Linear backlog, and creates them after your confirmation.

```
You: /forge:triage
     "We need auth, a dashboard with charts, and email notifications.
      Also the onboarding flow is broken on mobile."

Forge: Extracted 4 projects:
       1. User Authentication System
       2. Analytics Dashboard
       3. Email Notification Service
       4. Mobile Onboarding Fix
       Creating in Linear...
```

### Step 2: Spec & Plan (`/forge:spec`)

Select a project from your Linear backlog. Forge scans your codebase (structure, patterns, dependencies), conducts an adaptive interview (leading with recommendations, not blank-slate questions), then generates a PRD with milestones and syncs everything back to Linear.

```
You: /forge:spec

Forge: Scanning codebase... found Next.js + Prisma + tRPC
       Based on your stack, I recommend:
       - Milestone 1: Database schema + auth provider
       - Milestone 2: Login/signup UI components
       - Milestone 3: Session management + middleware
       [Interview continues with focused questions...]
       PRD generated -> Milestones created in Linear
```

### Step 3: Execute (`/forge:go`)

Executes milestones using a 3-tier agent team architecture:

```
┌─────────────────────────────────────────────┐
│  Lead Agent (you / forge:go orchestrator)    │
│  Plans waves, assigns work, manages state    │
├─────────────────────────────────────────────┤
│  Reviewer Agent (persistent, Opus)           │
│  Reviews diff after each wave, files issues  │
├─────────────────────────────────────────────┤
│  Builder Agents (parallel, per-wave)         │
│  Execute tasks, write code, run local checks │
│  + optional Notetaker (3+ waves or 4+ agents)│
└─────────────────────────────────────────────┘
```

Each milestone is broken into **waves** -- groups of independent tasks that run in parallel. Between waves, mechanical verification gates (types, lint, tests) catch errors, and a self-healing loop retries up to `maxIterations` times before stopping.

```
You: /forge:go

Forge: Executing Milestone 1: Database Schema
       Wave 1: [schema-agent] [migration-agent] -- parallel
       Verify: tsc --noEmit ... PASS
       Reviewer: 1 finding → fix agent spawned → resolved
       Wave 2: [seed-agent] [test-agent] -- parallel
       Verify: types PASS | lint PASS | tests PASS
       Milestone 1 complete. Creating PR...
```

### Step 4: Auto-Chain (Optional)

Run all remaining milestones autonomously:

```bash
npx forge run
```

Each milestone executes in a fresh session with full verification. Stall detection stops the loop if a milestone fails to make progress.

### Supporting Skills

| Skill | Purpose |
|-------|---------|
| `/forge:setup` | Initialize or refresh project scaffolding, hooks, and config |
| `/forge:update` | Check for and install the latest forge-cc version |

---

## Verification Gates

Gates are the core of forge-cc's quality enforcement. Each gate checks one aspect of your codebase and returns structured results with file paths, line numbers, and actionable error messages.

| Gate | What It Checks | Requires |
|------|---------------|----------|
| `types` | TypeScript compilation (`tsc --noEmit`) | `typescript` in dependencies |
| `lint` | Biome linting (`biome check`) | `@biomejs/biome` in dependencies |
| `tests` | Test suite (`npm test`) | A `test` script in package.json |
| `visual` | Multi-viewport screenshots (desktop, tablet, mobile) + DOM extraction + before/after comparison + console error detection | Dev server config, `playwright` |
| `runtime` | HTTP endpoint validation (status codes, response shape) | Dev server config, endpoint list |
| `prd` | Diff against PRD acceptance criteria | PRD file path, git history |
| `review` | Code review against PRD criteria and CLAUDE.md rules | Git history |
| `codex` | Post-PR review comment polling -- waits for Codex review comments on the PR and surfaces unresolved findings | `gh` CLI, open PR |

### Gate Remediation

When gates fail, forge-cc doesn't just report errors -- it generates structured remediation templates that give fix agents actionable instructions. Each error includes the file, line, message, and a specific remediation step.

### Pipeline Behavior

Gates run in the configured order. If all three core gates (types, lint, tests) fail, remaining gates are skipped to save time. Each gate has a 2-minute timeout.

---

## Configuration

Create a `.forge.json` in your project root:

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
  "linearProject": "My Project",
  "review": {
    "blocking": false
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gates` | `string[]` | `["types", "lint", "tests"]` | Verification gates to run |
| `maxIterations` | `number` | `5` | Max retry iterations for the verify loop |
| `verifyFreshness` | `number` | `600000` | Cache validity period in ms (default: 10 min) |
| `devServer.command` | `string` | -- | Command to start the dev server |
| `devServer.port` | `number` | -- | Dev server port |
| `devServer.readyPattern` | `string` | -- | Stdout pattern indicating server is ready |
| `prdPath` | `string` | -- | Path to PRD for acceptance criteria checking |
| `linearProject` | `string` | -- | Linear project name for lifecycle tracking |
| `review.blocking` | `boolean` | `false` | When `true`, review findings fail the gate |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `FORGE_LINEAR_API_KEY` | API key for Linear integration (preferred) |
| `LINEAR_API_KEY` | Alternative name for the Linear API key |

Set either variable in your shell environment to enable Linear lifecycle management.

---

## CLI Reference

### `forge verify`

Run verification gates against the current project.

```bash
npx forge verify                              # Run all configured gates
npx forge verify --gate types,lint            # Run specific gates
npx forge verify --json                       # Output structured JSON
npx forge verify --prd .planning/prds/active.md  # Include PRD check
```

Exit code `0` = all gates pass. Exit code `1` = any gate fails.

Results are cached per-branch to `.forge/verify-cache/<branch>.json`.

### `forge status`

Print current project state: branch, last verification result, config source, and active sessions.

```bash
npx forge status
```

### `forge setup`

Initialize a new project with forge-cc scaffolding or reinstall skills.

```bash
npx forge setup                # Full project initialization
npx forge setup --skills-only  # Only install skills to ~/.claude/commands/forge/
npx forge setup --with-visual  # Auto-install Playwright without prompting
npx forge setup --skip-deps    # Skip optional dependency checks
```

### `forge doctor`

Check environment health and optional dependency status. Reports what's installed, what's missing, and how to fix it.

```bash
npx forge doctor
```

Example output:

```
## Forge Environment

  ✓ forge-cc v0.1.12
  ✓ Node.js v22.13.1
  ✓ git 2.47.1
  ✓ gh CLI 2.67.0 (authenticated)
  ✗ Playwright — not installed
    → npm install -g playwright && npx playwright install chromium
  ✗ Chromium browser — not installed
    → npx playwright install chromium

2 issues found. Run the commands above to fix.
```

### `forge cleanup`

Remove stale worktrees, deregister dead sessions, and reclaim disk space.

```bash
npx forge cleanup
```

### `forge run`

Execute all remaining milestones autonomously in fresh Claude sessions.

```bash
npx forge run                      # Run until all milestones complete
npx forge run --max-iterations 10  # Safety cap on iterations
npx forge run --prd <slug>         # Run milestones for a specific PRD
npx forge run --all                # Run all PRDs with pending milestones
```

---

## Enforcement

forge-cc provides two enforcement mechanisms that block unverified commits.

### Claude Code Hook (Recommended)

Intercepts `git commit` and checks: branch protection, verification required, verification passed, and freshness.

Add to `.claude/settings.json`:

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

### Git Pre-Commit Hook

Standard git hook for non-Claude-Code environments. Same checks as the Claude Code hook. Wire `src/hooks/pre-commit.ts` into your hook runner (husky, simple-git-hooks, etc.).

### Version Check Hook (Optional)

Prints a one-line notice when a newer forge-cc version is available. Never blocks execution.

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

---

## MCP Server

Expose verification gates as MCP tools for programmatic agent access.

Add to `.mcp.json`:

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

**Available tools:**

| Tool | Description |
|------|-------------|
| `forge_verify_types` | Run TypeScript type checking |
| `forge_verify_lint` | Run Biome linting |
| `forge_verify_tests` | Run project test suite |
| `forge_verify_visual` | Multi-viewport screenshots + DOM comparison |
| `forge_verify_runtime` | Validate API endpoints |
| `forge_verify_prd` | Check changes against PRD criteria |
| `forge_run_pipeline` | Run full verification pipeline |

All tools accept `projectDir` (absolute path) and return structured JSON results.

---

## Linear Integration

forge-cc manages the full Linear project lifecycle automatically:

```
Backlog  ──>  Planned  ──>  In Progress  ──>  In Review  ──>  Done
   |             |               |                |             |
 triage       spec/PRD       go/execute       PR created    PR merged
```

Set `FORGE_LINEAR_API_KEY` (or `LINEAR_API_KEY`) in your environment and `linearProject` in `.forge.json` to enable.

---

## Concurrency & Session Isolation

forge-cc supports multiple simultaneous sessions on the same repository using git worktrees.

**How it works:**

1. Each forge skill creates a worktree in `../.forge-wt/<repo>/<session-id>/` with its own branch
2. Active sessions are tracked in `.forge/sessions.json`
3. Each session has its own git index -- parallel agents can't corrupt each other
4. On completion, state merges back intelligently (not last-write-wins)
5. Crashed sessions are detected via PID and cleaned up with `npx forge cleanup`

**Parallel milestones:** Independent milestones (no `dependsOn` conflicts) execute simultaneously, each producing their own branch and PR.

**Platform notes:**
- **Windows:** 8-char hex session IDs avoid the 260-character path limit. Atomic writes use retry-on-rename for Windows file locking.
- **Git:** Requires git 2.5+ for worktree support.

---

## For New Team Members

Joining a project that uses forge-cc:

```bash
# 1. Clone and install
git clone <repo-url> && cd <repo>
npm install

# 2. Initialize forge (installs skills, hooks, scaffolding)
npx forge setup
# Add --with-visual if the project uses visual or runtime gates

# 3. Check your environment
npx forge doctor

# 4. Verify your environment works
npx forge verify

# 5. Start working
# Use /forge:go to execute milestones, or just code normally --
# the pre-commit hook ensures verification passes before any commit.
```

The gates run the same checks as CI, so if `npx forge verify` passes locally, CI will pass too.

---

## Project Structure

```
forge-cc/
  src/
    cli.ts              # CLI entry point (npx forge)
    server.ts           # MCP server (stdio transport)
    types.ts            # Core type definitions
    gates/              # Verification gates + remediation templates
    config/             # .forge.json schema + auto-detection
    linear/             # Linear API client + lifecycle management
    hooks/              # Pre-commit hook logic
    reporter/           # Human (markdown) and JSON output formatting
    state/              # Session state reader/writer
    spec/               # Spec interview engine + PRD generation
    go/                 # Execution engine + verify loop + auto-chain
    setup/              # Project scaffolding templates
    worktree/           # Git worktree manager + session registry + state merge
    utils/              # Platform utilities (atomic writes, path normalization)
  skills/               # Claude Code skill definitions
  hooks/                # Installable hook files
  tests/                # Test suite (515+ tests, vitest)
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Build
npm test             # Run tests (515+ tests)
npm run dev          # Watch mode
npx forge verify     # Verify forge-cc itself
```

**Tech stack:** TypeScript (ES2022, strict), Node.js 18+, MCP SDK, Commander, Playwright, Zod, Vitest

---

## License

MIT
