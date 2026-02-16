# forge-cc — Harness Engineering Upgrade

**Project:** Forge Harness Upgrade
**Status:** Draft
**Branch:** feat/forge-harness
**Created:** 2026-02-15
**Assigned To:** Troy

## Overview

Add three missing verification capabilities to forge-cc inspired by OpenAI's harness engineering patterns: (1) enhanced visual gate with before/after screenshot comparison, multi-viewport capture, and DOM extraction, (2) a code review gate that checks PRD compliance and CLAUDE.md rules via a reviewer subagent, and (3) gate-specific remediation templates that give fix agents actionable instructions instead of raw error dumps. Together these close the gap between "code compiles and passes tests" and "code actually looks right and matches the spec."

## Problem Statement

forge-cc has a solid verification pipeline (types, lint, tests) and a self-healing fix loop, but three critical gaps remain:

1. **Visual verification is shallow.** The current `visual-gate.ts` launches Playwright, navigates pages, takes screenshots, and checks for console errors — but never actually *looks* at the screenshots. Claude Code is multimodal and can read PNG files natively, but the visual gate doesn't use this capability. Screenshots are saved to `.forge/screenshots/` and ignored. There is no before/after comparison, no multi-viewport capture, and no DOM structure extraction. This means agents write code that compiles and passes tests but renders incorrectly — the most common failure mode reported by the user.

2. **No code review gate.** The verify loop checks types, lint, and tests, but never reads the code holistically to check if it matches the PRD's intent, follows CLAUDE.md conventions, or introduces structural problems. OAI's Codex team uses agent-to-agent review as a core quality gate. forge-cc has the infrastructure (gate registry, verify loop with `onFixAttempt` callback) but no review gate implementation.

3. **Fix agents get raw errors.** When the self-healing loop spawns a fix agent, it passes raw compiler/linter errors via `formatErrorsForAgent()`. This works for types/lint but produces poor results for visual failures and review findings. OAI's key insight is that error messages should be "remediation templates" — structured instructions designed to guide the fix agent toward the right solution, not just describe the problem.

## User Stories

### US-1: Visual Before/After Comparison
**As** a developer running `/forge:go`, **I want** the visual gate to capture screenshots before and after each wave, compare them against PRD expectations, and produce structured errors when the UI doesn't match, **so that** the self-healing loop can fix visual regressions automatically.

**Acceptance Criteria:**
- [ ] Visual gate captures "before" screenshots at the start of milestone execution
- [ ] Visual gate captures "after" screenshots at each wave boundary
- [ ] Screenshots are taken at multiple viewports (desktop 1280x800, tablet 768x1024, mobile 390x844)
- [ ] DOM structure is extracted alongside screenshots for non-visual analysis
- [ ] A visual reviewer function compares before/after + DOM and produces `GateError[]` with remediation hints
- [ ] Visual page targets are driven by PRD `pages` field with `.forge.json` fallback

### US-2: Code Review Gate
**As** a developer, **I want** a `review` gate in the forge verification pipeline that reads the diff, checks it against the PRD and CLAUDE.md rules, and produces structured issues, **so that** the self-healing loop catches intent mismatches that types/lint/tests cannot detect.

**Acceptance Criteria:**
- [ ] `review` gate registered in `gateRegistry` alongside types, lint, tests
- [ ] Review checks: PRD compliance (does the diff implement what the milestone specifies?) and CLAUDE.md rule compliance
- [ ] Review produces `GateError[]` with file, line, message, and remediation
- [ ] Review is non-blocking by default (warnings, not errors) with config to make it blocking
- [ ] Review gate runs after types/lint/tests in the pipeline (needs clean code to review)

### US-3: Gate Remediation Templates
**As** the self-healing fix loop, **I want** each gate to produce error messages formatted as actionable fix instructions rather than raw error dumps, **so that** fix agents can resolve issues faster and more accurately.

**Acceptance Criteria:**
- [ ] `GateError.remediation` field is populated by all gates (types, lint, tests, visual, review)
- [ ] Remediation messages include: what to change, where to change it, why the change is needed
- [ ] `formatErrorsForAgent()` in `verify-loop.ts` renders remediation prominently
- [ ] Types gate: adds "expected type X, got Y — change parameter/return type" remediation
- [ ] Lint gate: adds rule-specific fix instructions (e.g., "remove unused import on line N")
- [ ] Visual gate: adds viewport-specific instructions (e.g., "element .nav overflows on mobile 390px — add overflow-x: hidden or reduce padding")
- [ ] Review gate: adds PRD reference (e.g., "PRD says 'show loading spinner' but no spinner component found — add a Spinner to the loading state")

## Technical Approach

### Architecture

All new code plugs into existing infrastructure — no new coordination mechanisms needed:

```
src/
  gates/
    visual-gate.ts        # MODIFY — add multi-viewport, DOM extraction, before/after
    visual-capture.ts     # NEW — viewport management, screenshot capture, DOM extraction
    visual-reviewer.ts    # NEW — before/after comparison, structured error output
    review-gate.ts        # NEW — code review gate (diff + PRD + rules → GateError[])
    remediation.ts        # NEW — remediation template builders for all gates
    types-gate.ts         # MODIFY — add remediation to errors
    lint-gate.ts          # MODIFY — add remediation to errors
    tests-gate.ts         # MODIFY — add remediation to errors
    index.ts              # MODIFY — register review gate
  types.ts                # MODIFY — add VisualCaptureResult, ReviewResult types
```

### Visual Gate Enhancement

The current visual gate (`visual-gate.ts`) will be restructured:

1. **Capture module** (`visual-capture.ts`): Handles viewport management, screenshot capture at multiple breakpoints, DOM structure extraction via `page.evaluate()`. Returns a `VisualCaptureResult` with screenshots per viewport and serialized DOM.

2. **Reviewer module** (`visual-reviewer.ts`): Takes before/after `VisualCaptureResult` pairs, compares DOM structures for unexpected changes, and produces `GateError[]` with remediation. Uses structural DOM comparison (element counts, visibility, layout shifts) rather than pixel diffing — this works without external image comparison libraries.

3. **Before snapshots**: Captured once at milestone start (before Wave 1). Stored in `.forge/screenshots/before/`. After snapshots taken at each wave boundary, stored in `.forge/screenshots/after/`.

4. **Page targets**: Read from PRD milestone's `pages` field if present, fall back to `.forge.json` `devServer.pages`, fall back to `["/"]`.

5. **Viewports**: Desktop (1280x800), tablet (768x1024), mobile (390x844). Configurable via `.forge.json` `visual.viewports` but defaults cover the standard set.

### Code Review Gate

New `review-gate.ts`:
- Runs `git diff --cached` (or `git diff HEAD~1`) to get the changeset
- Reads the PRD milestone section for intent
- Reads CLAUDE.md for coding rules
- Builds a structured prompt: "Review this diff against the PRD and rules. Output JSON array of issues."
- Parses the response into `GateError[]`
- Non-blocking by default (errors become warnings unless `review.blocking: true` in config)

The review gate uses a **function-based approach** — it builds a review prompt and uses the existing `GateError` structure. It does NOT spawn a subagent (that's the skill's job during the fix loop). The gate itself is a pure function that takes input and returns structured results.

### Remediation Templates

New `remediation.ts` module with builder functions per gate type:
- `buildTypeRemediation(error)`: Parses TS error codes, adds "change X to Y" instructions
- `buildLintRemediation(error)`: Maps ESLint/Biome rule names to fix instructions
- `buildVisualRemediation(error)`: Adds viewport-specific CSS/layout fix hints
- `buildReviewRemediation(error)`: Adds PRD section references

Each gate calls the appropriate builder after collecting raw errors, enriching `GateError.remediation` before returning.

### Dependencies

- No new npm dependencies. Playwright is already a peer dependency. DOM extraction uses Playwright's built-in `page.evaluate()`. Review gate uses string-based diff analysis (git diff output parsing), not external diff libraries.
- Chrome DevTools MCP (`chrome-devtools-mcp`) is noted as an optional future enhancement for richer runtime inspection but is NOT required for this PRD. The visual gate works with Playwright alone.

## Scope

### In Scope
- Multi-viewport screenshot capture (desktop, tablet, mobile) via Playwright
- DOM structure extraction via `page.evaluate()`
- Before/after screenshot management (stored in `.forge/screenshots/{before,after}/`)
- Visual reviewer with structural DOM comparison
- Code review gate with PRD + CLAUDE.md compliance checking
- Remediation template builders for types, lint, tests, visual, and review gates
- Integration with existing gate registry and verify loop
- Unit tests for all new modules
- Config schema updates for visual viewports and review gate options

### Out of Scope
- Pixel-level image diffing (no external image comparison libraries)
- Chrome DevTools MCP integration (future enhancement, not this PRD)
- AI-powered screenshot analysis via Claude vision (the gate produces structured data; the skill/agent reads screenshots if needed)
- Automated PRD generation from visual diffs
- Performance benchmarking of visual gate overhead
- Review gate running external linters beyond what's already configured

### Sacred / Do NOT Touch
- Existing gate test files (`tests/gates/*`) — add new tests, don't modify existing ones
- Linear integration (`src/linear/*`) — not relevant
- Worktree manager (`src/worktree/*`) — not relevant
- CLI command structure (`src/cli.ts`) — no changes needed
- `src/go/executor.ts` — the executor is the skill's data layer, not modified by this PRD
- `src/go/auto-chain.ts` — auto-chain orchestration is not modified

## Milestones

### Milestone 1: Multi-Viewport Visual Capture + DOM Extraction

**Goal:** Replace the single-viewport screenshot-only visual capture with a multi-viewport capture module that takes screenshots at 3 breakpoints and extracts DOM structure. This is the foundation — Milestone 2 builds comparison on top of it.

**Wave 1 (2 agents parallel):**
1. **capture-module**: Build the visual capture module with multi-viewport screenshot support and DOM extraction. Takes a Playwright page, iterates viewports (desktop 1280x800, tablet 768x1024, mobile 390x844), takes full-page screenshots at each, extracts serialized DOM structure via `page.evaluate()`. Returns `VisualCaptureResult` with screenshots array and DOM snapshot. Handle viewport resize, wait for layout settle, and screenshot naming conventions (`{page}_{viewport}.png`).
   - Creates: `src/gates/visual-capture.ts`
   - Modifies: `src/types.ts` (add `VisualCaptureResult`, `ViewportConfig`, `DOMSnapshot` types)

2. **capture-tests**: Write unit tests for the capture module. Mock Playwright's page API (setViewportSize, screenshot, evaluate). Test: 3 viewports produce 3 screenshots, DOM extraction returns element tree, graceful handling when viewport resize fails, screenshot naming convention matches expected pattern.
   - Creates: `tests/gates/visual-capture.test.ts`

**Verification:**
```bash
npx tsc --noEmit
npm test
```

**Acceptance:**
- `VisualCaptureResult` type exists in `types.ts` with screenshots array and DOM snapshot
- `captureVisual()` function accepts a Playwright page + options and returns `VisualCaptureResult`
- Tests pass for multi-viewport capture and DOM extraction
- No changes to existing gate implementations

---

### Milestone 2: Before/After Comparison + Visual Reviewer

**dependsOn:** 1
**Goal:** Add before/after snapshot management and a visual reviewer that compares DOM structures to produce `GateError[]` with remediation hints. Wire the enhanced visual gate into the gate registry.

**Wave 1 (2 agents parallel):**
1. **visual-reviewer**: Build the visual reviewer module. Takes before and after `VisualCaptureResult` pairs, compares DOM snapshots structurally (element count changes, missing/added elements, visibility changes, layout dimension shifts). Produces `GateError[]` where each error includes the viewport that detected the issue, the DOM path of the problematic element, and a remediation hint. Does NOT do pixel comparison — uses DOM structural analysis only.
   - Creates: `src/gates/visual-reviewer.ts`

2. **visual-gate-refactor**: Refactor `visual-gate.ts` to use the capture module from M1. Replace the single-viewport inline capture with `captureVisual()` calls. Add before/after snapshot management: store "before" results in memory during gate initialization, capture "after" at verification time, pass both to the reviewer. Update the return type to include reviewer findings alongside console errors. Register the enhanced visual gate.
   - Modifies: `src/gates/visual-gate.ts`, `src/gates/index.ts`

**Wave 2 (2 agents parallel):**
1. **reviewer-tests**: Write tests for the visual reviewer. Test: identical DOMs produce no errors, added/removed elements produce errors with correct paths, layout dimension changes on specific viewports produce viewport-tagged errors, remediation messages reference the correct viewport and CSS property.
   - Creates: `tests/gates/visual-reviewer.test.ts`

2. **visual-gate-tests**: Write tests for the refactored visual gate. Test: gate calls captureVisual with 3 viewports, before/after flow produces comparison results, console errors still reported as before, gate result includes both console errors and reviewer findings.
   - Creates: `tests/gates/visual-gate.test.ts`

**Verification:**
```bash
npx tsc --noEmit
npm test
```

**Acceptance:**
- Visual reviewer compares before/after DOM and produces `GateError[]`
- Visual gate captures at 3 viewports and runs reviewer
- Existing console error detection still works
- All new and existing tests pass

---

### Milestone 3: Code Review Gate

**Goal:** Add a `review` gate to the forge verification pipeline that checks diffs against PRD intent and CLAUDE.md rules, producing structured `GateError[]` with remediation.

**Wave 1 (2 agents parallel):**
1. **review-gate**: Build the code review gate. Runs `git diff` to get the changeset, reads the PRD milestone section for intent, reads CLAUDE.md for coding rules, builds a structured review checklist, evaluates the diff against the checklist. Produces `GateError[]` with file, line (when determinable from diff hunks), message, and remediation referencing the PRD section or CLAUDE.md rule that was violated. Non-blocking by default (returns `passed: true` with warnings unless config says `review.blocking: true`). Register in `gateRegistry`.
   - Creates: `src/gates/review-gate.ts`
   - Modifies: `src/gates/index.ts` (register review gate), `src/types.ts` (add `ReviewResult` extending `GateResult`), `src/config/schema.ts` (add optional `review` config section)

2. **review-tests**: Write unit tests for the review gate. Mock `git diff` output with known hunks, provide test PRD content and CLAUDE.md rules, verify: matching diff produces no issues, diff missing PRD requirement produces error with remediation, diff violating CLAUDE.md rule produces error, non-blocking mode returns passed=true with warnings, blocking mode returns passed=false with errors.
   - Creates: `tests/gates/review-gate.test.ts`

**Verification:**
```bash
npx tsc --noEmit
npm test
```

**Acceptance:**
- `review` gate appears in `gateRegistry`
- Review produces `GateError[]` with PRD references in remediation
- Non-blocking by default, blocking via config
- All tests pass including existing gate tests (no regressions)

---

### Milestone 4: Gate Remediation Templates

**Goal:** Add remediation template builders for all gates so that fix agents receive actionable instructions instead of raw error messages. Enrich existing gates with remediation and wire the templates into `formatErrorsForAgent()`.

**Wave 1 (2 agents parallel):**
1. **remediation-module**: Build the remediation template module. Exports builder functions: `buildTypeRemediation(error)` parses TS error codes (e.g., TS2322 → "Type X not assignable to Y — change the parameter type or add a type assertion"), `buildLintRemediation(error)` maps common ESLint/Biome rule names to fix instructions (e.g., `no-unused-vars` → "Remove the unused import/variable on line N"), `buildVisualRemediation(error)` adds viewport-specific CSS hints (e.g., "Element overflows on mobile — add overflow-x: hidden"), `buildReviewRemediation(error)` adds PRD section references. Each builder is a pure function: `(error: GateError) => string`.
   - Creates: `src/gates/remediation.ts`

2. **gate-enrichment**: Modify existing gates (types, lint, tests) to call remediation builders after collecting raw errors. In `types-gate.ts`: parse TSC output, call `buildTypeRemediation()` on each error. In `lint-gate.ts`: parse linter output, call `buildLintRemediation()` on each error. In `tests-gate.ts`: add generic test failure remediation ("Test X failed — check the assertion on line N, expected vs actual values shown above"). Update `formatErrorsForAgent()` in `verify-loop.ts` to render `error.remediation` prominently (bold, indented under the error message).
   - Modifies: `src/gates/types-gate.ts`, `src/gates/lint-gate.ts`, `src/gates/tests-gate.ts`, `src/go/verify-loop.ts`

**Wave 2 (1 agent):**
1. **remediation-tests**: Write tests for the remediation module and verify enriched gate output. Test: each builder produces non-empty remediation for known error patterns, `formatErrorsForAgent()` includes remediation in output, gates that had no remediation before now populate the field.
   - Creates: `tests/gates/remediation.test.ts`
   - Modifies: (may update existing gate tests to check for remediation field)

**Verification:**
```bash
npx tsc --noEmit
npm test
```

**Acceptance:**
- All 5 gate types produce `GateError.remediation` for their errors
- `formatErrorsForAgent()` renders remediation prominently
- Fix agents receive actionable instructions, not just raw error messages
- All existing tests pass (no regressions)
- No new npm dependencies

## Verification

### Per-Milestone
- `npx tsc --noEmit` passes after every wave
- `npm test` passes after every wave
- No regressions in existing gate tests (349 tests baseline)

### Overall
- Visual gate captures screenshots at 3 viewports and extracts DOM
- Before/after comparison detects added/removed/changed elements
- Review gate checks diffs against PRD and CLAUDE.md
- All gates produce remediation-enriched errors
- Fix agents in the self-healing loop receive structured fix instructions
- Zero new npm dependencies
- Existing CLI, hooks, Linear, worktree, and state modules are untouched
