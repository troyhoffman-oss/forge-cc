# PRD: Linear Write Operations in Forge

## Problem & Goals

Forge-cc has a split-brain Linear architecture: `ForgeLinearClient` handles reads and state updates via `@linear/sdk`, while skills (`/forge:triage`, `/forge:spec`) rely on an external Linear MCP server (`https://mcp.linear.app/mcp`) for create operations. That MCP server doesn't implement `create_project` (and likely other create tools), which means **forge cannot create projects, milestones, or issues in Linear**. This blocks the entire triage-to-execution pipeline.

The existing code also has quality issues: silent failures in update operations, dead code (`linearMilestoneId` written but never read), unused methods, sequential API calls where batch APIs exist, and an MCP server (`src/server.ts`) that exposes one tool nobody uses.

### Goals

1. **Forge owns all Linear operations** — reads, writes, and state transitions — through one path: CLI commands backed by `@linear/sdk`. No MCP dependency.
2. **Every skill works end-to-end** — triage creates projects, spec creates milestones and issues, go manages the full lifecycle through "Done."
3. **Clean, minimal codebase** — remove dead code, fix silent failures, use batch APIs. No bandaids.

### Success Criteria

- `/forge:triage` creates projects in Linear after user confirmation
- `/forge:spec` creates milestones, issues, and relationships in Linear after PRD approval
- `/forge:go` transitions all entities through Planned → In Progress → In Review → Done
- All Linear operations fail loudly with clear error messages
- Zero dependency on external MCP servers for core workflows
- `src/server.ts` removed entirely

## User Stories

### Primary User: Developer using forge skills

1. **Triage workflow**: User runs `/forge:triage`, dumps ideas, confirms extracted projects. Forge creates them in Linear with correct team, priority, and blocked/blocking relationships. User sees CLI commands flash by — projects appear in Linear.

2. **Spec workflow**: User runs `/forge:spec`, selects a project, completes the interview. Forge creates milestones and issues in Linear, sets dependencies between issues (blocked/blocking), transitions project to "Planned."

3. **Execution workflow**: User runs `/forge:go`. Forge transitions the project, all milestones, and all issues to "In Progress" as a unit. As milestones complete, their issues transition to "Done." After the final PR is submitted, everything moves to "In Review." After the user approves the merge (through the agent), forge transitions everything to "Done."

### Error States

- **Invalid API key**: Fail immediately with clear message ("LINEAR_API_KEY is invalid or expired. Regenerate it in Linear settings.")
- **Network failure**: Retry once, then fail with message. Do not silently continue.
- **Partial batch failure**: Report which items succeeded and which failed. Do not silently skip.
- **Missing config**: If `linearTeam` is not set in `.forge.json`, fail with instructions to run `/forge:setup`.

## Technical Approach

### Architecture: One Path to Linear

```
Skill (markdown) → Claude runs CLI command → CLI creates ForgeLinearClient → @linear/sdk + API key → Linear API
```

- **@linear/sdk** (already installed, v75.0.0) provides all required methods: `createProject`, `createProjectMilestone`, `createIssue`, `createIssueBatch`, `updateIssueBatch`, `createProjectRelation`, `createIssueRelation`
- **CLI commands** under `forge linear` namespace are the single interface
- **Skills** instruct Claude to run CLI commands via Bash
- **MCP server removed entirely** — `src/server.ts` deleted, `@modelcontextprotocol/sdk` dependency removed

### ForgeLinearClient Expansion

Add to `src/linear/client.ts`:

**Create methods:**
- `createProject(input: { name, description, teamIds, priority? })` → returns `{ id, url }`
- `createMilestone(input: { name, description?, projectId, targetDate? })` → returns `{ id }`
- `createIssue(input: { title, description?, teamId, projectId?, milestoneId?, priority?, stateId? })` → returns `{ id, identifier }`
- `createIssueBatch(issues: IssueCreateInput[])` → returns `{ ids[], identifiers[] }`

**Relationship methods:**
- `createProjectRelation(input: { projectId, relatedProjectId, type })` → returns `{ id }`
- `createIssueRelation(input: { issueId, relatedIssueId, type })` → returns `{ id }`

**Batch state transitions:**
- `updateIssueBatch(ids: string[], input: { stateId })` → returns `{ success, failed[] }`

**All methods return structured results** — `{ success: true, data }` or `{ success: false, error }`. No silent failures. No void returns.

**Fix existing methods:**
- `updateIssueState` → return `{ success, error? }` instead of void
- `updateProjectState` → return `{ success, error? }` instead of void

**Remove dead methods:**
- `listTeams()` — zero callers (will be re-added as a CLI-facing method with proper return types)
- `listProjects()` — zero callers (same)

### CLI Commands

Restructure under `forge linear` namespace:

```
forge linear create-project --name <name> --team <team> [--description <desc>] [--priority <0-4>]
forge linear create-milestone --project <id> --name <name> [--description <desc>]
forge linear create-issue --team <team> --title <title> [--project <id>] [--milestone <id>] [--description <desc>]
forge linear create-issue-batch --team <team> --project <id> --milestone <id> --issues <json>
forge linear create-project-relation --project <id> --related-project <id> --type <blocks|blocked>
forge linear create-issue-relation --issue <id> --related-issue <id> --type <blocks|duplicate|related>
forge linear sync-start --slug <slug> --milestone <n>
forge linear sync-complete --slug <slug> --milestone <n> [--last]
forge linear sync-done --slug <slug>
forge linear list-issues --slug <slug>
forge linear list-teams
forge linear list-projects [--team <team>]
```

All commands:
- Read `LINEAR_API_KEY` from environment
- Fail loudly if key is missing or invalid
- Output JSON to stdout (for skill consumption)
- Exit non-zero on failure

### Sync Refactor

Collapse `syncMilestoneStart`, `syncMilestoneComplete`, `syncProjectDone` into cleaner patterns:
- Use `updateIssueBatch` for parallel state transitions instead of sequential loops
- Return structured results (how many succeeded, how many failed)
- Check for empty issue lists BEFORE resolving state IDs (avoid wasted API calls)

### Skill Updates

All three skills updated to use `forge linear` CLI commands:

**forge-triage.md:**
- Replace `mcp__linear__list_projects` → `npx forge linear list-projects --team "X"`
- Replace `mcp__linear__list_teams` → `npx forge linear list-teams`
- Replace `mcp__linear__create_project` → `npx forge linear create-project --name "X" --team "Y"`
- Add `npx forge linear create-project-relation` for blocked/blocking

**forge-spec.md:**
- Replace `mcp__linear__create_milestone` → `npx forge linear create-milestone`
- Replace `mcp__linear__create_issue` → `npx forge linear create-issue` or `create-issue-batch`
- Replace `mcp__linear__update_project` → `npx forge linear sync-start` (for Planned → In Progress)
- Add issue relation creation for dependencies

**forge-go.md:**
- Replace `forge linear-sync start` → `forge linear sync-start`
- Replace `forge linear-sync complete` → `forge linear sync-complete`
- Add `forge linear sync-done` call after user approves PR merge
- Keep `Closes TEAM-123` in PR body as nice-to-have for GitHub-Linear integration

### Dead Code Removal

- **Remove `src/server.ts`** — MCP server (unused, no config references it)
- **Remove `@modelcontextprotocol/sdk`** from dependencies
- **Remove `linearMilestoneId`** from status schema and all references (written but never read)
- **Remove `--pr-url` option** from CLI (accepted but never used)
- **Remove `dist/server.js` export** from package.json

## Scope

### In Scope
- Expand `ForgeLinearClient` with create, batch, and relationship methods
- Fix return types on existing update methods (success/error, not void)
- Add `forge linear` CLI commands for all operations
- Remove MCP server and `@modelcontextprotocol/sdk` dependency
- Remove dead code (linearMilestoneId, unused methods, --pr-url)
- Update all three skill files to use CLI commands
- Add forge:go "Done" transition after PR merge
- Add tests for all new methods and commands

### Out of Scope
- Two-pass spec (separate project, blocked by this one)
- Setup workflow Linear onboarding (separate project, blocked by this one)
- Cross-milestone knowledge transfer (separate project, independent)
- IDE integrations / MCP re-addition
- GitHub-Linear integration setup or configuration

### Sacred Files
- `src/gates/` — verification gates, unrelated
- `src/worktree/` — worktree management, unrelated
- `src/runner/loop.ts` — will be updated to use new sync methods, but core loop logic untouched
- `src/spec/` — spec engine, unrelated (skill file changes only)

## Milestones

### Milestone 1: Linear Client Write Operations + Cleanup
**Goal:** ForgeLinearClient becomes the complete Linear interface — reads, writes, state transitions, relationships, batch operations. All dead code removed. All methods return structured results.

**Issues:**
- [ ] Add createProject method to ForgeLinearClient
- [ ] Add createMilestone method to ForgeLinearClient
- [ ] Add createIssue and createIssueBatch methods to ForgeLinearClient
- [ ] Add createProjectRelation and createIssueRelation methods
- [ ] Add updateIssueBatch method for batch state transitions
- [ ] Fix updateIssueState and updateProjectState to return success/error
- [ ] Remove dead code: linearMilestoneId field, unused listTeams/listProjects, --pr-url
- [ ] Remove src/server.ts and @modelcontextprotocol/sdk dependency
- [ ] Update status schema (remove linearMilestoneId from Zod schema)
- [ ] Add comprehensive tests for all new and modified methods

### Milestone 2: CLI Commands + Sync Refactor
**dependsOn:** 1
**Goal:** All Linear operations exposed as CLI commands under `forge linear` namespace. Existing sync logic refactored to use batch APIs and return structured results.

**Issues:**
- [ ] Add `forge linear create-project` command
- [ ] Add `forge linear create-milestone` command
- [ ] Add `forge linear create-issue` and `create-issue-batch` commands
- [ ] Add `forge linear create-project-relation` and `create-issue-relation` commands
- [ ] Add `forge linear list-teams` and `list-projects` commands
- [ ] Restructure `linear-sync` commands under `forge linear` namespace (sync-start, sync-complete, sync-done)
- [ ] Refactor sync.ts to use updateIssueBatch and return structured results
- [ ] Remove old `linear-sync` command group
- [ ] Remove server.js export from package.json
- [ ] Add CLI integration tests

### Milestone 3: Skill Updates + E2E Verification
**dependsOn:** 2
**Goal:** All three skills use CLI commands for Linear operations. Full triage → spec → go pipeline works end-to-end.

**Issues:**
- [ ] Update forge-triage.md to use `forge linear` CLI commands
- [ ] Update forge-spec.md to use `forge linear` CLI commands
- [ ] Update forge-go.md to use new command names and add Done transition after merge
- [ ] Add blocked/blocking relationship creation to triage and spec skill flows
- [ ] Verify triage creates projects successfully (manual E2E)
- [ ] Verify spec creates milestones and issues successfully (manual E2E)
- [ ] Verify go transitions lifecycle correctly (manual E2E)
- [ ] Update CLAUDE.md if any instructions reference MCP or old command names
