# PRD: PR-Issue Auto-Linking

## Problem & Goals

Forge's Linear integration has a critical bug: all project state transitions silently fail because `resolveStateId()` queries issue workflow state UUIDs and passes them as project status IDs — which are different entity types in Linear's API. Projects never move from Backlog despite the code appearing to transition them.

Additionally, `syncMilestoneComplete` transitions issues to "Done" before a PR is created, racing with Linear's built-in PR automations ("On PR open → In Review", "On PR merge → Completed"). The manual transition preempts the automation, preventing the "In Review" state from ever appearing.

The state resolution is also brittle — state names are hardcoded in config (`linearStates.done = "Done"`) and break when users rename states (e.g., "Done" → "Completed").

**Goals:**
1. Fix project state transitions so projects actually move through Backlog → Planned → In Progress → Completed
2. Replace name-based state resolution with category-based auto-detection for both issues and projects
3. Stop racing with Linear's PR automations — let PR open/merge handle issue state transitions
4. Add a `sync-planned` command so `/forge:spec` can promote projects from Backlog → Planned
5. Remove the brittle `linearStates` config entirely

**Success criteria:**
- Projects transition through all states during the forge lifecycle (verifiable in Linear UI)
- Issue transitions are handled by Linear's PR automations (In Review on PR open, Completed on PR merge)
- Renaming workflow states in Linear does not break forge

## User Stories

**As a forge user running /forge:go**, I want projects to move from In Progress → Completed when I confirm a PR merge, so I can see accurate project status in Linear without manual intervention.

**As a forge user running /forge:spec**, I want the project to move from Backlog → Planned after milestones and issues are created, so my team knows which projects have been specced and are ready for execution.

**As a team lead reviewing Linear**, I want issues to show "In Review" when a PR is open and "Completed" when the PR merges, so I can see the actual review pipeline status.

**As a forge user who renames workflow states**, I want forge to keep working without config changes, so I don't have to debug silent failures when I customize my Linear workspace.

## Technical Approach

### Category-Based State Resolution

Linear's workflow states and project statuses both have category types:

**Issue workflow states** have categories: `backlog`, `unstarted`, `started`, `completed`, `canceled`
- "In Progress" → category: `started`
- "In Review" → category: `started`
- "Completed" → category: `completed`

**Project statuses** have categories: `backlog`, `planned`, `started`, `completed`, `canceled`, `paused`
- "Backlog" → category: `backlog`
- "Planned" → category: `planned`
- "In Progress" → category: `started`
- "Completed" → category: `completed`

New resolution methods on `ForgeLinearClient`:
- `resolveIssueStateByCategory(teamId, category)` — queries `workflowStates` filtered by team + type
- `resolveProjectStatusByCategory(category)` — queries `projectStatuses` (workspace-level) filtered by type

For issue states where multiple states share a category (e.g., "In Progress" and "In Review" are both `started`), we pass a `name` hint to disambiguate. For the common case (just need "started"), we take the first match.

### Sync Flow Changes

**syncMilestoneStart:** Use category-based resolution for both issues (→ started/In Progress) and project (→ started).

**syncMilestoneComplete:** Stop transitioning issues entirely. Let Linear's PR automations handle it (PR open → In Review, PR merge → Completed). For projects: no transition (project stays In Progress until sync-done).

**syncProjectDone:** Use category-based resolution. Issues → completed (safety net). Project → completed.

**New: syncProjectPlanned:** Promote-only transition. Query current project status category. If `backlog`, transition to `planned`. If already `planned` or higher, no-op. Called by `/forge:spec` after creating milestones.

### Config Changes

Remove `linearStates` from `forgeConfigSchema` in `src/config/schema.ts`. All state resolution is auto-detected by category. No config needed.

### CLI Changes

- Add `sync-planned` command under `forge linear`
- Update `sync-start`, `sync-complete`, `sync-done` to use category-based resolution
- Remove any references to `config.linearStates`

### Skill Changes

- Update `/forge:spec` to call `npx forge linear sync-planned --slug {slug}` after creating milestones/issues
- Update `/forge:go` references if any mention linearStates

## Scope

### In Scope
- New `resolveIssueStateByCategory()` and `resolveProjectStatusByCategory()` methods on `ForgeLinearClient`
- New `syncProjectPlanned()` function in `sync.ts`
- New `sync-planned` CLI command
- Update `syncMilestoneStart`, `syncMilestoneComplete`, `syncProjectDone` to use category-based resolution
- Remove `linearStates` from config schema
- Remove `resolveStateId()` method (replaced by category-based methods)
- Stop issue transitions in `syncMilestoneComplete`
- Update `/forge:spec` skill to call `sync-planned`
- Tests for new resolution methods and updated sync functions

### Out of Scope
- Linear templates for project/issue creation (follow-up project)
- Linear attachment API (PR URL attachments on issues)
- Changes to `/forge:triage`
- Changes to PR creation logic in `/forge:go` (already includes `Closes` keywords)
- Multi-org/workspace support

### Sacred Files
None — all files are fair game.

## Milestones

### Milestone 1: Category-Based State Resolution + Config Cleanup

**Goal:** Replace the broken name-based state resolution with category-based auto-detection for both issues and projects. Remove the `linearStates` config. Add `sync-planned` command.

**Issues:**
- [ ] Add `resolveIssueStateByCategory(teamId, category, nameHint?)` method to `ForgeLinearClient` — queries `workflowStates` by team + type category, optional name hint for disambiguation
- [ ] Add `resolveProjectStatusByCategory(category)` method to `ForgeLinearClient` — queries workspace-level `projectStatuses` by type category
- [ ] Remove `linearStates` from `forgeConfigSchema` and `ForgeConfig` type — delete the schema, remove all references in config loader, types, and callers
- [ ] Remove `resolveStateId()` method from `ForgeLinearClient` — replace all usages with new category-based methods
- [ ] Add `syncProjectPlanned()` to `sync.ts` — promote-only transition (Backlog → Planned, no-op if already higher)
- [ ] Add `sync-planned` CLI command under `forge linear` — calls `syncProjectPlanned()`
- [ ] Add tests for `resolveIssueStateByCategory`, `resolveProjectStatusByCategory`, and `syncProjectPlanned`

### Milestone 2: Sync Flow Update + End-to-End Verification

**dependsOn:** 1
**Goal:** Update all sync functions to use category-based resolution, stop issue transitions in sync-complete, update the spec skill, and verify the full lifecycle.

**Issues:**
- [ ] Update `syncMilestoneStart` — use `resolveIssueStateByCategory(teamId, "started")` for issues and `resolveProjectStatusByCategory("started")` for project
- [ ] Update `syncMilestoneComplete` — remove all issue state transitions (let PR automation handle it), remove project "In Review" transition (project stays In Progress until sync-done)
- [ ] Update `syncProjectDone` — use `resolveIssueStateByCategory(teamId, "completed")` for issues and `resolveProjectStatusByCategory("completed")` for project
- [ ] Update `/forge:spec` skill — add `npx forge linear sync-planned --slug {slug}` call after milestone/issue creation in Step 5
- [ ] Update tests for `syncMilestoneStart`, `syncMilestoneComplete`, `syncProjectDone` to verify category-based resolution and new behavior
- [ ] Run `npx tsc --noEmit` and `npm test` to verify all changes compile and pass
