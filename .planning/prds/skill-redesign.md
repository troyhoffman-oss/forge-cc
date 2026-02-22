# PRD: Skill Redesign

## Problem & Goals

Forge's workflow skills (`forge:triage`, `forge:spec`, `forge:go`) were designed for monolithic PRDs with milestone sections. The graph planning layer is now complete — atomic requirement files, dependency DAG, wave computation, graph-aware runner. But the skills still generate and consume the old format. They need to be rebuilt from scratch to produce requirement graphs and execute against them.

This isn't a rename. The skills are restructured with new capabilities: adversarial review in build, vertical slice enforcement in plan, surgical recovery via fix, and ad-hoc execution via quick.

**Goal:** Replace all 3 workflow skills with 5 graph-native skills, backed by reference docs that define the review protocol, sizing heuristics, and graph correction pathway.

**Success criteria:**
- 5 new skill files: `forge-capture.md`, `forge-plan.md`, `forge-build.md`, `forge-fix.md`, `forge-quick.md`
- 3 reference files: `ref/adversarial-review.md`, `ref/requirement-sizing.md`, `ref/graph-correction.md`
- Old skill files renamed (not deleted — content replaced)
- All skills reference the graph module (`loadIndex`, `findReady`, `writeIndex`, etc.) not milestone regex
- Cross-references between skills and reference docs are correct
- `forge-setup.md` and `forge-update.md` updated to reference new skill names

## Technical Approach

- **Spec source:** `.planning/skill-redesign-v2.md` contains the approved v2 structures for all 5 skills and 3 reference files. That document IS the spec — write skills to match it exactly.
- **Reference files** go in `skills/ref/` — deep protocol docs that main skills reference but don't inline.
- **No code changes.** This PRD produces only `.md` files in `skills/` and `skills/ref/`. No TypeScript, no tests.
- **Skill files** are Claude Code slash commands — they contain instructions that Claude follows, not code that runs.

## Scope

### In Scope
- 3 reference files in `skills/ref/`
- 5 skill files in `skills/`
- Updating `forge-setup.md` and `forge-update.md` skill name references
- Deleting old skill content (files are renamed, not left as duplicates)

### Out of Scope
- TypeScript code changes (graph module, runner, linear sync — already done)
- CLI command changes
- Test changes
- CLAUDE.md updates (separate task)

### Sacred Files
- `src/**` — do not modify any TypeScript
- `tests/**` — do not modify any tests
- `.planning/skill-redesign-v2.md` — the spec, do not modify

## Milestones

### Milestone 1: Reference Files + Skill Renames
**Goal:** Create the 3 reference documents that define adversarial review protocol, requirement sizing heuristics, and graph correction pathway. Rename existing skill files to new names and add placeholder stubs for new skills (forge-fix, forge-quick).

**Issues:**
- [ ] Create `skills/ref/adversarial-review.md` — Review protocol: what the reviewer receives (requirement file + actual files on disk, NOT the diff, NOT the builder's summary), stub detection heuristics (empty bodies, hardcoded returns, TODO comments, console.log-only implementations, happy-path-only tests), review checklist (acceptance criteria verification, file scope verification, side effect detection, security check), structured output format (PASS/FAIL with findings)
- [ ] Create `skills/ref/requirement-sizing.md` — Hard limits: max 6 acceptance criteria, max 5 files (creates + modifies combined), max 1 group per requirement. Soft limits: >4 criteria or >3 files triggers warning. Splitting guide: identify distinct user-facing behaviors, each becomes a vertical slice, add dependency edges between slices. Vertical slice examples showing bad (horizontal layers) vs good (end-to-end behaviors)
- [ ] Create `skills/ref/graph-correction.md` — Correction types: discovered requirements (disc-NNN, status discovered, surfaced to user), missing dependency edges (validate no cycle before applying), file scope corrections (applied silently), group ordering corrections (surfaced to user). Checkpoint timing: between requirements, never mid-execution. Auto-apply rules for --auto mode: file scope always, new edges if no cycle, new requirements and group ordering queue for user review
- [ ] Rename skill files: `forge-triage.md` → `forge-capture.md`, `forge-spec.md` → `forge-plan.md`, `forge-go.md` → `forge-build.md`. Create stub `forge-fix.md` and `forge-quick.md`. Update `forge-setup.md` and `forge-update.md` to reference new names.

**Wave 1 (3 agents parallel — ref files have no dependencies):**
1. **review-ref-agent**: Creates `skills/ref/adversarial-review.md`
   - Creates: skills/ref/adversarial-review.md
2. **sizing-ref-agent**: Creates `skills/ref/requirement-sizing.md`
   - Creates: skills/ref/requirement-sizing.md
3. **correction-ref-agent**: Creates `skills/ref/graph-correction.md`
   - Creates: skills/ref/graph-correction.md

**Wave 2 (1 agent — needs ref files to exist for cross-references):**
1. **rename-agent**: Renames skill files, creates stubs, updates setup/update cross-references
   - Modifies: skills/forge-setup.md, skills/forge-update.md
   - Renames: skills/forge-triage.md → skills/forge-capture.md, skills/forge-spec.md → skills/forge-plan.md, skills/forge-go.md → skills/forge-build.md
   - Creates: skills/forge-fix.md, skills/forge-quick.md

### Milestone 2: Planning Skills (capture + plan)
**dependsOn:** 1
**Goal:** Write the two planning-side skills that produce input for the execution pipeline. forge:capture converts brain dumps into Linear projects/issues. forge:plan runs an adaptive interview and produces a requirement graph.

**Issues:**
- [ ] Write `skills/forge-capture.md` (~150 lines) — Brain dump → Linear. Steps: collect brain dump, extract projects (name, description, priority), dedup against existing Linear projects, present & confirm via AskUserQuestion, optional issue extraction (re-scan brain dump for actionable items per project, present grouped for confirmation), create in Linear with state "Planned" for both projects and issues. Report: "Created N projects, M issues."
- [ ] Write `skills/forge-plan.md` (~280 lines) — Interview → requirement graph. Steps: detect context (--from-capture flag loads Linear project description, existing vs greenfield codebase detection), codebase scan (existing only: tech stack, file tree depth 2, sacred files), adaptive interview (branch on existing vs greenfield, converge on acceptance criteria per behavior), requirement sizing check (refer to ref/requirement-sizing.md, enforce hard limits, auto-split oversized requirements), generate graph (write _index.yaml, overview.md, requirement .md files with frontmatter), quiz & iterate (present graph: groups, requirements with deps, estimated waves — ask about granularity, dependencies, missing slices, sacred files — iterate until user approves), Linear sync (create project at Planned, create issues at Planned, store IDs in _index.yaml). Vertical slice enforcement is CRITICAL: each requirement = one user-facing behavior wired end-to-end across ALL layers. Behavioral acceptance criteria ("user can log in") not structural ("POST /auth/login returns 200").

**Wave 1 (2 agents parallel — no file overlap):**
1. **capture-agent**: Writes `skills/forge-capture.md`
   - Modifies: skills/forge-capture.md (replacing stub from M1)
2. **plan-agent**: Writes `skills/forge-plan.md`
   - Modifies: skills/forge-plan.md (replacing stub from M1)

### Milestone 3: Execution Skills (build + fix + quick)
**dependsOn:** 2
**Goal:** Write the three execution-side skills. forge:build orchestrates graph execution with adversarial review. forge:fix provides surgical recovery. forge:quick handles ad-hoc tasks.

**Issues:**
- [ ] Write `skills/forge-build.md` (~300 lines) — Graph execution with adversarial review. Steps: load graph (loadIndex, findReady, check completion/blockers), execution loop (while !isProjectComplete: pick first ready requirement by priority desc → group order → insertion order, execute, handle result, reload index), per-requirement execution with worktree lifecycle (create worktree on feat/{slug}/{reqId} branch, build in worktree, verify gates, adversarial review per ref/adversarial-review.md, merge to feat/{slug} on success, cleanup worktree), prompt construction order (overview first → transitive deps topological → completed dep artifacts as actual file contents → target requirement LAST in attention-sharp zone), context budget priority (target req → completed dep artifacts → overview → transitive dep reqs → codebase files), build iterations (max 3: build → verify → review, review findings feed back into next iteration), failure handling (after max iterations: AskUserQuestion with skip/retry/stop/fix options, skip keeps status in_progress and preserves worktree), discovered requirements and dependencies (new reqs as disc-NNN discovered status, missing edges validated for cycles then applied, file scope corrections applied silently, group ordering surfaced to user — per ref/graph-correction.md), Linear state transitions (Issue: Planned → In Progress on start, In Progress → Done on verified+merged; Project: Planned → In Progress once on first req, In Progress → Done when all complete; failures logged and continued, never block on Linear)
- [ ] Write `skills/forge-fix.md` (~150 lines) — Surgical recovery. Steps: select requirement (interactive if no req-id argument, show in_progress/failed requirements with last errors), load context (requirement file + direct deps + current files on disk + last verification errors + adversarial review findings), diagnose (present current state: which files exist, verification status, review findings, root cause analysis), fix (work in existing worktree if preserved or create new, targeted fix only, run verify + adversarial review), complete (merge worktree, update status to complete, Linear issue → Done), optional resume (AskUserQuestion: run forge:build or stop)
- [ ] Write `skills/forge-quick.md` (~100 lines) — Ad-hoc tasks. Steps: collect task (AskUserQuestion: one sentence description), optional Linear integration (AskUserQuestion: track in Linear? If yes: pick team from .forge.json, create issue at Planned, transition to In Progress), execute (no graph, no requirements — direct build → verify with types+lint+tests, single worktree on fix/quick-{timestamp} or feat/quick-{timestamp} branch), complete (if Linear: issue → Done, create PR or commit, report result)

**Wave 1 (1 agent — forge-build.md is the largest and most complex):**
1. **build-agent**: Writes `skills/forge-build.md`
   - Modifies: skills/forge-build.md (replacing stub from M1)

**Wave 2 (2 agents parallel — fix and quick are independent):**
1. **fix-agent**: Writes `skills/forge-fix.md`
   - Modifies: skills/forge-fix.md (replacing stub from M1)
2. **quick-agent**: Writes `skills/forge-quick.md`
   - Modifies: skills/forge-quick.md (replacing stub from M1)
