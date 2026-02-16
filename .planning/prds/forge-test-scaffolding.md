# PRD: Forge Test Scaffolding & Verification UX

## Problem & Goals

### Problem
forge-cc has verification gates, a consensus review protocol, a verify loop, and agent team orchestration — but the testing story is broken. The test gate (`tests-gate.ts`) runs `npm run test -- --run` and silently passes when no test script exists. A new user gets "all clear" when there's literally nothing being verified.

This means the entire verification pipeline — the verify loop in `/forge:go`, the pre-commit hook, the consensus review — is running on an empty foundation. Agent teams build milestone after milestone with zero test coverage, and forge reports success every time.

The deeper problem: forge's target users are "vibe coders" — solo developers and small teams using AI-assisted development who may not come from a professional testing background. They don't know that tests are project-specific (not included with the plugin), don't know what to test, and don't know how to set up a test framework. Forge should close this gap the same way it closes the gap for PRD planning (via `/forge:spec`) — by guiding the user through it interactively.

### Philosophy (from OAI Harness Engineering)
forge-cc was built on the principles from OpenAI's "Harness Engineering" article:
- **Structural tests enforce architecture** — not just unit tests, but mechanical checks on naming, imports, boundaries
- **Agents write tests as part of every PR** — tests aren't optional output, they're required output
- **Taste invariants are encoded as rules** — custom lints with remediation messages injected into agent context
- **Agent-to-agent review catches gaps** — the consensus protocol evaluates quality including test coverage

forge already has the consensus module, the verify loop, and remediation hints. What's missing is the test layer that makes them meaningful.

### Goal
Wire testing into the end-to-end forge workflow so that:
1. **No silent passes** — the test gate fails or warns loudly when there are zero tests or when new code lacks corresponding test files
2. **Interactive test planning** — `/forge:setup` walks users through what should be tested via AskUserQuestion, then scaffolds the agreed-upon suite
3. **Tests are part of every milestone** — `/forge:spec` PRDs include test acceptance criteria, so `/forge:go` agents write tests alongside feature code
4. **The verify loop has teeth** — test gate enforcement means agent teams can't pass verification without tests for their new code
5. **Pre-baked + project-specific** — forge includes common structural test patterns AND generates project-specific tests based on framework detection

### North Star
The forge workflow (triage → spec → go → verify) produces PRs containing the work defined in the PRD, verified by meaningful tests that agent teams write and run iteratively until everything passes. The test gate is the backbone that makes the verify loop, consensus review, and pre-commit hook actually work.

### Success Criteria
- [ ] `npx forge verify` on a zero-test project produces a FAIL with specific remediation: what files need tests, how to scaffold them
- [ ] `/forge:setup` includes an interactive test planning walkthrough (AskUserQuestion) that analyzes the project and lets the user confirm what to test
- [ ] Scaffolded tests are framework-aware (Next.js, React, Node/Express, plain TypeScript) and include structural tests
- [ ] `/forge:spec` PRDs include "write tests for new code" as acceptance criteria in every milestone
- [ ] The test gate enforces that new/changed source files have corresponding test files (agents can't skip tests)
- [ ] Agent teams spawned by `/forge:go` write tests alongside feature code and the verify loop catches missing tests

## User Stories

### Primary Persona: Solo Vibe Coder
A non-professional developer using Claude Code to build real applications. They ship products but don't come from a testing/CI background. They installed forge-cc because they want their AI-generated code to be production quality, but they don't know how to make the verification pipeline actually verify anything.

**Story 1: Interactive test planning during setup**
> As a vibe coder running `/forge:setup` on my existing Next.js project, I want forge to analyze my codebase, show me what it recommends testing (API routes, components, utils), and walk me through confirming the test plan via interactive questions — then scaffold everything I agreed to.

**Story 2: Honest verification**
> As a user running `npx forge verify`, I want the test gate to fail when I have no tests for my source files, with specific messages like "8 API routes in `app/api/` have no corresponding test files. Run `/forge:setup` to scaffold tests." — not silently pass.

**Story 3: Tests wired into every PRD**
> As a user running `/forge:spec`, I want every milestone to automatically include test acceptance criteria ("All new API routes must have test files"), so that when `/forge:go` spawns agent teams, they write tests alongside the feature code and the verify loop catches it if they don't.

**Story 4: Enforcement in the verify loop**
> As a user whose agent teams are running `/forge:go`, I want the test gate to detect that agents added `src/api/users.ts` but no `tests/api/users.test.ts`, and fail verification — forcing the agents to loop and write the missing tests before the milestone completes.

**Story 5: Structural tests out of the box**
> As a user who doesn't know about structural testing, I want forge to scaffold basic architectural checks (no circular imports, consistent file naming, boundary validation) alongside my unit tests, so my codebase stays clean as agents generate code.

### Secondary Persona: Small Team Lead
A developer onboarding teammates onto a forge-managed project. Needs consistent test standards.

**Story 6: Team consistency**
> As a team lead, I want forge's test scaffolding and enforcement rules to be configured in `.forge.json`, so all team members' agent-generated code follows the same testing standards automatically.

## Technical Approach

### Architecture
All changes extend existing forge-cc modules. No new top-level commands or skills. Testing guidance surfaces in the existing workflow: `/forge:setup` for planning and scaffolding, test gate for enforcement, `/forge:spec` for PRD criteria.

### 1. Test Analysis Engine (new: `src/gates/test-analysis.ts`)
Analyzes a project's codebase and produces a structured report:
- **Source-to-test mapping**: Cross-reference `src/**/*.ts` against `tests/**/*.test.ts` (or detected test directory convention)
- **Categorization**: Group untested files by type — API routes, React components, utility functions, database models, middleware
- **Framework detection**: Identify test runner (vitest/jest/none), app framework (Next.js App Router/Pages, React+Vite, Express, plain TS), existing test patterns
- **Coverage ratio**: Source file count vs test file count, with per-category breakdown

Output: `TestAnalysisReport` with categories, file lists, and recommendations.

### 2. Enhanced Test Gate (modify: `src/gates/tests-gate.ts`)
Two modes of operation:
- **Baseline check**: If zero tests exist, return FAIL with structured remediation ("Run `/forge:setup` to scaffold tests")
- **Enforcement check**: If tests exist, verify that new/changed source files (from `git diff`) have corresponding test files. Missing test files = FAIL with file-specific remediation
- **Thin coverage advisory**: If test ratio is very low relative to source count, add warnings

Remediation messages follow the OAI pattern: inject actionable instructions into the error output so agents can self-correct.

### 3. Test Scaffolding Engine (new: `src/setup/test-scaffold.ts`)
Generates test infrastructure based on the analysis report:
- **Config files**: `vitest.config.ts` or `jest.config.ts` with correct paths and coverage settings
- **Package.json**: Adds `test` script and test runner devDependency if missing
- **Unit test stubs**: Framework-aware templates:
  - Next.js API routes → request/response test stubs
  - React components → render + interaction test stubs (React Testing Library)
  - Utility functions → input/output test stubs
  - Express routes → supertest-based test stubs
- **Structural test stubs**: Pre-baked architectural checks:
  - No circular imports (dependency direction validation)
  - Consistent file naming conventions
  - Export boundary validation (public API surface)

Templates are self-documenting: descriptive test names explain what's being tested and why.

### 4. Interactive Test Planning (in `/forge:setup` flow)
AskUserQuestion walkthrough during setup:
1. Run test analysis engine on the project
2. Present findings: "I found 12 source files across 3 categories..."
3. Walk through each category with AskUserQuestion: "You have 4 API routes in `app/api/`. Want me to scaffold tests for them?"
4. Confirm the test plan: show what will be generated
5. Scaffold agreed-upon files
6. Persist the testing config in `.forge.json` under a `testing` section

### 5. `.forge.json` Testing Config
New optional section:
```json
{
  "gates": ["types", "lint", "tests"],
  "testing": {
    "enforce": true,
    "runner": "vitest",
    "testDir": "tests",
    "sourceDir": "src",
    "structural": true,
    "categories": ["api-routes", "components", "utils"]
  }
}
```
- `enforce`: When true, test gate fails on missing test files for new code (default: true after setup)
- `structural`: Include structural/architectural tests (default: true)
- `categories`: Which test categories were agreed upon during interactive planning

### 6. Spec Integration (modify: `src/spec/generator.ts` + `src/spec/templates.ts`)
Every generated milestone in a PRD includes:
- Test acceptance criteria: "All new source files must have corresponding test files"
- Verification command: `npx forge verify --gate tests`
- Agent instruction: "Write tests alongside feature code. The test gate will enforce coverage."

### 7. Verify Loop Integration
The existing verify loop in `src/go/verify-loop.ts` already runs gates and spawns fix agents on failure. With the enhanced test gate:
- Gate fails → remediation message says exactly which files need tests → fix agent writes the tests → re-verify
- No changes needed to the verify loop itself — the test gate's better output feeds directly into the existing self-healing mechanism

### Stack
- TypeScript (consistent with existing codebase)
- Vitest for forge-cc's own tests of new modules
- No new dependencies — file system scanning + template generation is pure Node.js
- Zod for the new `.forge.json` testing config schema

## Scope

### In Scope
- Test analysis engine (source-to-test mapping, categorization, framework detection)
- Enhanced test gate with enforcement mode (fail on missing tests for new code)
- Test scaffolding engine with framework-aware templates + structural test stubs
- Interactive test planning walkthrough in `/forge:setup` via AskUserQuestion
- `.forge.json` testing config section
- Spec integration (test criteria in every milestone)
- Tests for all new forge-cc modules
- Remediation messages that follow OAI pattern (actionable, agent-parseable)

### Out of Scope
- CI/CD pipeline generation (GitHub Actions, etc.) — forge stays focused on local dev workflow
- Coverage percentage thresholds (enforce file-level coverage, not line-level)
- E2E/Playwright test scaffolding (visual gate handles this separately)
- AST-level code analysis (framework detection from package.json + glob patterns is sufficient for v1)
- Modifying the verify loop itself (it already handles gate failures correctly)
- Modifying the consensus protocol (it already evaluates quality; better test gate output feeds into it naturally)

### Sacred Files
- `src/gates/visual-gate.ts` — don't modify, visual testing is separate
- `src/gates/runtime-gate.ts` — don't modify, runtime testing is separate
- `src/gates/codex-gate.ts` — don't modify, Codex integration is separate
- `src/go/verify-loop.ts` — don't modify, it already handles gate failures
- `src/team/consensus.ts` — don't modify, it already evaluates quality

## Milestones

### Milestone 1: Smart Test Gate
**Goal:** Make the test gate honest and enforceable. `npx forge verify` produces real, actionable feedback about test coverage — and can fail when new code lacks tests.
**Issues:**
- [ ] Build test analysis module (`src/gates/test-analysis.ts`) — source-to-test file mapping, categorize untested code by type (routes, components, utils, middleware), framework detection (vitest/jest, Next.js/React/Express/plain TS)
- [ ] Enhance `tests-gate.ts` with two modes — baseline check (zero-test FAIL) and enforcement check (new files without tests FAIL via git diff analysis)
- [ ] Add structured remediation messages — file-specific ("Missing: tests/api/users.test.ts for src/api/users.ts") and actionable ("Run `/forge:setup` to scaffold tests")
- [ ] Extend `.forge.json` schema with `testing` config section (enforce, runner, testDir, sourceDir, structural, categories) via Zod
- [ ] Update config loader to parse and apply testing config
- [ ] Write tests for the test analysis module and enhanced gate behavior

### Milestone 2: Test Scaffolding Engine
**dependsOn:** 1
**Goal:** Generate framework-aware test infrastructure — config, scripts, unit test stubs, and structural test stubs — so users go from zero to a working test suite in one interactive session.
**Issues:**
- [ ] Build test scaffold module (`src/setup/test-scaffold.ts`) — orchestrates config generation, package.json updates, and test file creation based on a TestAnalysisReport
- [ ] Create framework-aware unit test templates — Next.js API routes (request/response), React components (render + interaction via RTL patterns), utility functions (input/output), Express routes (supertest patterns)
- [ ] Create structural test templates — no circular imports, consistent file naming, export boundary validation
- [ ] Generate test config files — `vitest.config.ts` or `jest.config.ts` with correct paths and coverage settings for the detected framework
- [ ] Package.json updates — add test script and test runner devDependency if missing
- [ ] Write tests for the scaffolding engine (verify correct files generated per framework type, verify structural tests are included)

### Milestone 3: Workflow Integration
**dependsOn:** 2
**Goal:** Wire test planning and scaffolding into `/forge:setup` and test criteria into `/forge:spec`, so testing is part of the standard forge workflow — no new commands to learn.
**Issues:**
- [ ] Add interactive test planning to `/forge:setup` — run analysis, present findings via AskUserQuestion walkthrough (per-category confirmation), scaffold agreed-upon files, persist config to `.forge.json`
- [ ] Update `src/setup/templates.ts` — include testing section in setup templates and setup skill flow
- [ ] Extend `/forge:spec` PRD generation — auto-include test acceptance criteria in every milestone ("All new source files must have corresponding test files") and verification command (`npx forge verify --gate tests`)
- [ ] Update `src/spec/generator.ts` and `src/spec/templates.ts` — inject test criteria into milestone definitions of done and agent instructions
- [ ] End-to-end integration test — verify full flow: setup (interactive planning) → scaffold → verify (enforcement) → spec (criteria) → go (agents write tests) → verify loop catches gaps
- [ ] Update forge-setup skill (`skills/forge-setup.md`) to document the test planning walkthrough step
