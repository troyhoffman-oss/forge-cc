# Forge: E2E Autonomous Dev Workflow — Research Specification

**Project:** forge-mcp (research phase)
**Status:** Ready for execution
**Branch:** feat/forge-research
**Created:** 2026-02-15
**Assigned To:** Troy
**Linear Project:** Forge: E2E Workflow Research (MSIG-62 through MSIG-67)

## Overview

Research project to design the optimal end-to-end autonomous development workflow for a small team (Troy + Matt) using Claude Code, Flow skills, Linear, and verification tooling. Inspired by OpenAI's "Harness Engineering" article, the goal is to minimize human intervention between "idea" and "clean PR" while scaling to a multi-developer team.

The deliverable is a **Recommendation Document** — not code. That document becomes the input for a follow-up `/flow:spec` that produces the actual build PRD.

## Problem Statement

Troy's current workflow (Flow skills + Linear + Claude Code) works but has significant friction:

1. **PRs need too much rework** — agents ship code that doesn't fully meet acceptance criteria, has slop, or misses edge cases. The human has to iterate multiple times post-PR.
2. **Verification is weak** — Flow's verification is string commands in CLAUDE.md (`npx tsc --noEmit && npx biome check`). No structured feedback loops, no visual validation, no PRD compliance checking.
3. **Flow skills are suggestions, not enforcement** — Skills are markdown files that *guide* Claude Code but can't *enforce* behavior. Steps get skipped, quality varies session to session.
4. **Linear drift** — Status transitions mostly work via GitHub auto-close, but issue creation from `/flow:spec`, progress comments, and milestone tracking have gaps.
5. **Matt joins tomorrow** — The workflow needs to be repeatable by a second developer without tribal knowledge.
6. **Distribution & updates** — Whatever gets built, Matt (and future devs) must be able to install it easily and receive updates consistently as the tool evolves. No manual file copying, no "pull this repo and build it yourself." Flow already solved this via npm (`npm install -g @troyhoffman/flow` + `/flow:update`), so the bar is set.

The OAI article demonstrated that investing in "harness engineering" (environments, feedback loops, verification gates, architectural enforcement) produces 10x throughput. Troy wants to apply those principles to his Claude Code + Flow setup.

## Scope

### In Scope
- Full audit of Flow plugin (every skill file, every manual touchpoint)
- Gap analysis: OAI harness engineering vs Troy's current setup
- Linear integration lifecycle analysis
- Verification and feedback loop architecture research
- **Implementation vehicle analysis** — MCP server vs CLI tool vs npm package vs pure skill-file improvements vs hybrid. MCP is NOT assumed; the research must recommend the right approach.
- Multi-developer workflow scaling analysis
- Real-world pattern analysis from msig-am-etl (20+ shipped projects)
- Recommendation document with architecture, phasing, and trade-offs
- **(Nice-to-have) Agent-agnosticism assessment** — Can the tools work with both Claude Code AND Codex (and future agents)? The OAI article explicitly builds for "other agents (e.g. Aardvark) working on the codebase." What would it take to make the verification/harness layer agent-agnostic? This is a wish-list consideration, not a hard requirement.

### Out of Scope
- Writing code (this is research only)
- Modifying any existing files in flow-plugin, forge-mcp, or msig-am-etl
- Implementing any recommendations (that's the follow-up build PRD)
- Building IDE-specific plugins or extensions — but the solution MUST work when invoked from IDE-integrated terminals (Cursor, VS Code terminal, etc.), not just standalone terminal

### Sacred / Do NOT Touch
- No files modified in any repo. Research is read-only + document creation.

## User Stories

### US-1: Flow Plugin Audit
**Description:** As a workflow architect, I want a complete map of every manual intervention point in the Flow lifecycle, so that I can identify what to automate vs what to keep human-driven.
**Acceptance Criteria:**
- [ ] Every Flow skill file read in full (go.md, spec.md, done.md, setup.md, status.md, triage.md, task.md, intro.md, update.md)
- [ ] Document lists every human touchpoint (commands typed, questions answered, reviews needed, dead time between skills)
- [ ] Each touchpoint classified: "keep manual" / "automate" / "enforce programmatically" / "eliminate"
- [ ] Comparison of what Flow *says* should happen vs what *actually* happens (enforcement gap)

### US-2: OAI Pattern Mapping
**Description:** As a workflow architect, I want the OAI harness engineering principles mapped to my Claude Code + Flow context, so that I know which patterns to adopt and which are irrelevant.
**Acceptance Criteria:**
- [ ] Each OAI principle listed with applicability assessment (directly applicable / needs adaptation / not relevant)
- [ ] Key OAI concepts mapped: "repository as system of record", "layered domain architecture", "mechanical enforcement", "progressive disclosure", "feedback loops", "garbage collection", "agent legibility"
- [ ] Honest assessment of what's different (Codex cloud vs Claude Code local, 7-person team vs 2-person team, greenfield vs brownfield)
- [ ] Specific recommendations for Troy's setup derived from each applicable principle

### US-3: Linear Lifecycle Analysis
**Description:** As a project manager, I want to understand exactly where Linear integration works and where it breaks, so that the workflow maintains accurate project tracking end-to-end.
**Acceptance Criteria:**
- [ ] Full Linear status lifecycle mapped: issue creation → assignment → in progress → in review → done
- [ ] Each transition documented: who/what triggers it, is it automated or manual, where does it break?
- [ ] Gap list: what transitions are supposed to happen but don't (or happen inconsistently)
- [ ] Recommendation for ideal Linear lifecycle with automation points identified
- [ ] Assessment of current Flow skill Linear integration code (which skills touch Linear, how)

### US-4: Verification & Feedback Loop Architecture
**Description:** As a developer, I want to understand the full spectrum of verification options (from string commands to MCP tools to Playwright visual checks), so that the right verification architecture can be designed.
**Acceptance Criteria:**
- [ ] Current verification inventory: what checks exist across all Flow skills, what they catch, what they miss
- [ ] OAI verification patterns documented: Chrome DevTools loop, observability stack, before/after snapshots, self-review
- [ ] Feasibility assessment for each pattern in Claude Code context
- [ ] MCP vs CLI vs skill comparison for verification: what can each approach enforce?
- [ ] Existing forge-mcp code quality assessment: keep / rewrite / restructure
- [ ] Recommended verification pipeline (gates, ordering, feedback loops, escalation)

### US-5: Multi-Developer Process Analysis
**Description:** As a team lead onboarding a new developer, I want to know which parts of the workflow scale to 2+ people and which break, so that Matt can be productive from day one.
**Acceptance Criteria:**
- [ ] Current multi-dev architecture reviewed (docs/workflow/architecture.md, onboarding.md, worktrees.md)
- [ ] Gap analysis: what the architecture doc promises vs what Flow skills actually support
- [ ] Worktree + parallel development friction points identified
- [ ] Onboarding experience assessment: what's the minimum a new dev needs to know?
- [ ] Recommendation for process changes that make the workflow self-documenting for new devs

### US-6: Architecture Recommendation
**Description:** As the project owner, I want a single recommendation document that synthesizes all research into a concrete architecture and phased implementation plan, so that I can `/flow:spec` the build PRD directly from it.
**Acceptance Criteria:**
- [ ] Single document: `.planning/research/RECOMMENDATION.md`
- [ ] Architecture diagram: what goes where (the "where" is an open question — MCP server, CLI tool, npm package, Flow skill improvements, CLAUDE.md, CI, or some hybrid)
- [ ] **Implementation vehicle recommendation** with trade-off matrix: MCP server vs CLI tool vs npm package vs enhanced skills vs hybrid. Must justify the choice, not assume MCP.
- [ ] Phased implementation plan: MVP → v1 → v2 with clear scope per phase
- [ ] Trade-off analysis for all key decisions (vehicle choice, Playwright vs existing tools, etc.)
- [ ] "Day in the life" workflow: step-by-step what Troy and Matt's workflow looks like with the new system
- [ ] Estimated effort per phase (small/medium/large)
- [ ] Clear answer to: "What do we build first?"
- [ ] (Nice-to-have) Agent-agnosticism section: what would it take to make the solution work with Codex CLI too? What's the cost/benefit? Which vehicle choices maximize cross-agent compatibility?

## Technical Design

### Research Artifacts (Output Files)

All research output goes to `.planning/research/` in the forge-mcp repo:

| File | Producer | Contents |
|------|----------|----------|
| `flow-audit.md` | Wave 1 Agent | Complete Flow plugin audit with touchpoint map |
| `oai-patterns.md` | Wave 1 Agent | OAI principle mapping to Troy's context |
| `linear-lifecycle.md` | Wave 1 Agent | Linear integration analysis and gap list |
| `verification-analysis.md` | Wave 1 Agent | Verification inventory, patterns, feasibility |
| `msig-patterns.md` | Wave 1 Agent | Real-world usage patterns from msig-am-etl |
| `architecture-options.md` | Wave 2 Agent | MCP vs skills vs CLI decision framework |
| `multi-dev-gaps.md` | Wave 2 Agent | Multi-developer scaling analysis |
| `ideal-state.md` | Wave 2 Agent | Target workflow vision combining all inputs |
| `RECOMMENDATION.md` | Wave 3 Agent | Final synthesized recommendation |

### Key Existing Code (DO NOT Recreate — Reference Only)

| Path | What It Contains | Research Relevance |
|------|-----------------|-------------------|
| `C:/Users/TroyHoffman/flow-plugin/skills/` | All Flow skill .md files | Primary input for Flow audit |
| `C:/Users/TroyHoffman/forge-mcp/src/` | Existing gate implementations | Verification analysis input |
| `C:/Users/TroyHoffman/forge-mcp/ANALYSIS.md` | Prior research on forge-mcp | Starting context for verification research |
| `C:/Users/TroyHoffman/msig-am-etl/.planning/` | 20+ project PRDs, roadmap, state | Real-world workflow patterns |
| `C:/Users/TroyHoffman/msig-am-etl/CLAUDE.md` | Production CLAUDE.md with learned rules | Current enforcement approach |
| `C:/Users/TroyHoffman/msig-am-etl/tasks/lessons.md` | Battle-tested lessons from 20+ projects | Known pain points |
| `C:/Users/TroyHoffman/msig-am-etl/docs/workflow/` | Multi-dev architecture, onboarding, worktrees | Multi-dev analysis input |
| `C:/Users/TroyHoffman/Downloads/Harness engineering leveraging Code.txt` | Full OAI article text | OAI pattern mapping input |

### Vision Reference Materials (MUST be consumed by relevant agents)

These are Troy's inspiration materials. They define the "north star" for this research.

| Resource | Path | Used By |
|----------|------|---------|
| OAI Article (full text) | `C:/Users/TroyHoffman/Downloads/Harness engineering leveraging Code.txt` | ALL agents (inline in every prompt) |
| Chrome DevTools validation loop | `C:/Users/TroyHoffman/Downloads/fig_1__codex_drives_the_app_.webp` | verification-researcher, vision-architect |
| Full observability stack | `C:/Users/TroyHoffman/Downloads/Screenshot 2026-02-15 101910.png` | verification-researcher, vision-architect |
| "Agent can't see = doesn't exist" | `C:/Users/TroyHoffman/Downloads/OAI_Harness_engineering_The_limits_of_agent_knowledge_desktop-light (1).webp` | oai-researcher, vision-architect |
| Layered domain architecture | `C:/Users/TroyHoffman/OneDrive - MSIG/Documents/MSIG/Flow and Forge Examples/OAI_Harness_engineering_Layered_domain_architecture_with_explicit_cross-cutting_boundries_desktop-light.webp` | oai-researcher, architecture-designer |
| Canonical folder | `C:/Users/TroyHoffman/OneDrive - MSIG/Documents/MSIG/Flow and Forge Examples/` | All agents (reference path) |

### Input Context for All Agents

Every agent prompt MUST include:
1. The full OAI article text (from `Harness engineering leveraging Code.txt`) — this is the vision document
2. The relevant diagram images from the Vision Reference Materials table above
3. Troy's pain points: PRs need rework, verification is weak, skills are suggestions not enforcement, Linear drifts, needs to scale to 2 devs
4. Troy's goal: "idea → plan → clean PR with minimal manual intervention"
5. The msig-am-etl CLAUDE.md (shows current enforcement approach and learned rules)
6. The workflow architecture doc (shows multi-dev design)
7. **Critical framing:** MCP is NOT assumed as the implementation vehicle. The research must evaluate ALL options (MCP, CLI, npm package, enhanced skills, hybrid) and recommend the best fit.

## Implementation Milestones

### Milestone 1: Parallel Deep Research
**Assigned To:** Troy
**Goal:** Five agents independently research different aspects of the workflow, producing one document each.

**Wave 1 — Deep Research (5 agents parallel):**

1. **flow-auditor**: Reads every Flow skill file (`C:/Users/TroyHoffman/flow-plugin/skills/*.md`). Maps every human touchpoint, every enforcement gap, every place where steps get skipped. Produces `flow-audit.md`. Must read ALL skill files completely — not summaries. Must categorize each touchpoint as keep/automate/enforce/eliminate.

2. **oai-researcher**: Reads the full OAI article (`C:/Users/TroyHoffman/Downloads/Harness engineering leveraging Code.txt`). Maps each principle to Troy's context. Reads Troy's current setup (CLAUDE.md, workflow architecture) to assess gaps. Produces `oai-patterns.md`. Must also web-search for other "harness engineering" and "agent-first development" articles/discussions to supplement the OAI patterns. **Agent-agnosticism note:** The article mentions building tools that serve multiple agents (Codex + Aardvark). Include a section on what OAI's approach implies for agent-agnostic tooling — what's agent-specific vs agent-universal in their architecture?

3. **linear-analyst**: Reads all Flow skills that touch Linear (spec, go, done, triage, task, status). Traces the full issue lifecycle. Checks the actual Linear project via MCP tools (`mcp__linear__list_projects`, `mcp__linear__list_issues`, etc.) to see current state. Reads `docs/workflow/architecture.md` for the intended design. Produces `linear-lifecycle.md`.

4. **verification-researcher**: Reads all existing forge-mcp code (`C:/Users/TroyHoffman/forge-mcp/src/`). Reads ANALYSIS.md. Reads verification sections in all Flow skills. Reads msig-am-etl CLAUDE.md (verification commands and learned rules). Reads the OAI Chrome DevTools validation loop diagram and observability stack diagram (see Vision Reference Materials) to understand their feedback loop patterns. Web-searches for Claude Code verification approaches, CLI harness tools, MCP server patterns, and Playwright MCP. Must evaluate ALL implementation vehicles (MCP, CLI, npm package, skill improvements) — not just MCP. Produces `verification-analysis.md`.

5. **pattern-miner**: Reads msig-am-etl `.planning/ROADMAP.md`, `STATE.md`, `tasks/lessons.md`, `CLAUDE.md`, and 3-5 archived PRDs from `.planning/archive/`. Identifies patterns: what works, what repeatedly breaks, what lessons keep getting re-learned. Reads `docs/workflow/` for multi-dev gaps. Produces `msig-patterns.md`.

**Verification:** All 5 files exist in `.planning/research/` and each is >500 words with structured sections.
**Acceptance:** Covers US-1, US-2, US-3, US-4 (partial), US-5 (partial).

### Milestone 2: Cross-Cutting Analysis
**Assigned To:** Troy
**Goal:** Three agents consume Wave 1 research outputs to produce higher-order analysis documents.

**Wave 2 — Analysis (3 agents parallel):**

1. **architecture-designer**: Reads `flow-audit.md`, `verification-analysis.md`, `oai-patterns.md`, and the layered domain architecture diagram. Produces `architecture-options.md` — a decision framework with two dimensions: (A) **What goes where** — programmatic enforcement vs workflow guidance vs developer instructions vs CI gates, and (B) **What vehicle delivers it** — MCP server, CLI tool, npm package, enhanced Flow skills, CLAUDE.md improvements, or a hybrid. Must include a trade-off matrix comparing ALL vehicle options on: enforcement strength, ease of adoption, development effort, maintainability, multi-dev scaling, and Claude Code integration depth. Must address Troy's key insight: "skills are markdown, not hard rules — what's the right way to make them enforceable?" **Additional trade-off matrix columns:** (1) **Agent-agnosticism** — how well does each vehicle work across Claude Code, Codex CLI, and future agents? MCP = Claude-specific; CLI = universal; repo scripts = universal. (2) **Distribution & updates** — how do new team members install it? How do all devs get updates? E.g., npm global package = `npm install -g` + `npm update`; MCP = manual config per dev; repo-local = git pull. Flow already set the bar: `npm install -g @troyhoffman/flow` + `/flow:update`. Whatever we build should be at least that easy. (3) **Developer environment compatibility** — Matt may use Cursor or VS Code (not just standalone terminal). The solution must work across: standalone terminal, VS Code integrated terminal, Cursor integrated terminal, and any IDE that shells out to a terminal. Anything that depends on a specific terminal environment or shell configuration is a risk.

2. **multi-dev-analyst**: Reads `flow-audit.md`, `linear-lifecycle.md`, `msig-patterns.md`, and `docs/workflow/architecture.md`. Produces `multi-dev-gaps.md` — analysis of what breaks or degrades with 2+ developers. Must consider: parallel worktrees, PRD ownership, Linear assignment flow, session handoffs, verification consistency across devs.

3. **vision-architect**: Reads ALL Wave 1 outputs plus the OAI article. Produces `ideal-state.md` — the "north star" workflow. Describes the ideal day-in-the-life for Troy and Matt. Maps the full lifecycle: idea capture → triage → spec → plan → execute → verify → PR → review → merge → deploy → Linear tracking. Identifies which parts of this lifecycle can be fully automated vs need human judgment.

**Verification:** All 3 files exist in `.planning/research/` and reference specific findings from Wave 1 documents.
**Acceptance:** Covers US-4 (complete), US-5 (complete).

### Milestone 3: Synthesis
**Assigned To:** Troy
**Goal:** One agent reads everything and produces the final recommendation document.

**Wave 3 — Synthesis (1 agent):**

1. **synthesizer**: Reads ALL 8 research documents from Waves 1-2. Produces `RECOMMENDATION.md` — the authoritative document that answers: "What do we build, in what order, and why?" Must include:
   - Architecture diagram (text-based): what lives where
   - Phased implementation plan: MVP → v1 → v2
   - Trade-off analysis for key decisions
   - "Day in the life" workflow narrative for both Troy and Matt
   - Clear MVP definition: "Build THIS first, it delivers THESE benefits"
   - Effort estimates per phase (S/M/L)
   - Risk assessment: what could go wrong, what's the fallback

**Verification:** `RECOMMENDATION.md` exists, is >2000 words, includes all required sections, and provides a clear answer to "what do we build first?"
**Acceptance:** Covers US-6.

## Verification

### Per-Milestone
- **Milestone 1:** `ls .planning/research/` shows 5 .md files, each >500 words
- **Milestone 2:** `ls .planning/research/` shows 8 .md files, Wave 2 files reference Wave 1 findings
- **Milestone 3:** `RECOMMENDATION.md` exists with all required sections, is self-contained (readable without the other 8 docs)

### Overall
- The RECOMMENDATION.md is sufficient input for a `/flow:spec` session to produce a build PRD
- Troy can hand RECOMMENDATION.md to Matt and Matt understands the proposed workflow
