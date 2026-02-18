# PRD: Forge Linear Sync Fix

## Problem & Goals

The `npx forge linear-sync` CLI commands silently no-op during `/forge:go` execution. When a milestone completes, forge attempts to transition Linear issues and project state, but every sync call returns `null` with zero console output and exit code 0. The caller has no idea sync was skipped.

**Root causes:**
1. Missing `LINEAR_API_KEY` causes silent `null` returns with no warning
2. Milestone name lookup uses `M{N}: {name}` format but Linear stores just `{name}`
3. Issue state transitions pass name strings but Linear API expects state UUIDs
4. `transitionProject` throws plain `Error` instead of `LinearClientError`, bypassing the graceful error handler

**Goal:** Make the Linear sync pipeline actually work end-to-end, and make failures visible when they occur.

**Success criteria:**
- `npx forge linear-sync start` transitions milestone issues to "In Progress" in Linear
- `npx forge linear-sync complete` transitions issues to "Done" and adds progress comments
- `npx forge linear-sync done` transitions the project to "Completed"
- Missing `LINEAR_API_KEY` produces a visible stderr warning (not silent)
- All existing tests pass with updated assertions

## User Stories

- As a developer running `/forge:go`, I expect milestone completion to automatically update Linear issue and project states so I don't have to manually move cards.
- As a developer without `LINEAR_API_KEY` set, I expect a clear warning telling me sync was skipped so I know why Linear didn't update.

## Technical Approach

### Bug 1: Silent failure on missing LINEAR_API_KEY

**File:** `src/go/linear-sync-cli.ts`

All CLI adapter functions (`cliSyncStart`, `cliSyncComplete`, `cliSyncDone`, `cliFetchIssueIdentifiers`) catch `LinearClientError` and return `null` silently. The `createClientSafe` wrapper in `linear-sync.ts` does emit `console.warn`, but the CLI layer gates on `null` before reaching it.

**Fix:** Add `console.warn` to stderr in each CLI adapter function before returning `null` when the API key check fails. Use a consistent message format: `[linear-sync] WARN: LINEAR_API_KEY not set — skipping Linear sync`. Exit code stays 0 (sync is optional).

### Bug 2: Milestone name prefix mismatch

**File:** `src/go/linear-sync-cli.ts` — `resolveMilestoneName()` (line ~105)

`resolveMilestoneName` parses the PRD header `### Milestone N: {name}` and returns `M{N}: {name}`. But `/forge:spec` creates milestones in Linear with just `{name}`. The `findMilestoneByName` function does strict equality (`m.name === name`), so the lookup always fails.

**Fix:** Change `resolveMilestoneName` to return just the raw name (`return name`) instead of `return \`M${milestoneNumber}: ${name}\``. This matches what `/forge:spec` writes to Linear.

### Bug 3: State name vs UUID in issue transitions

**File:** `src/linear/issues.ts` — `transitionMilestoneIssues()`

The function passes state name strings (e.g., "In Progress") to `client.updateIssue()`, which maps them to `stateId` in the GraphQL mutation. Linear's API expects a UUID for `stateId`, not a name string.

**Fix:** Add a `resolveStateId(client, teamId, stateName)` helper that calls `client.listIssueStatuses(teamId)` to get the name-to-UUID mapping, then uses the UUID. Call this once per sync operation and pass the resolved UUID to `updateIssue`. This requires threading `teamId` through the sync functions — either as an additional parameter or by deriving it from the project's issues.

### Bug 4: Wrong error class in transitionProject

**File:** `src/linear/projects.ts` — `transitionProject()`

`transitionProject` throws plain `Error` for "project not found" and "invalid transition" cases. `syncLinearSafe` only catches `LinearClientError`, so these plain errors bypass the graceful handler and hit bare `catch {}` blocks in the sync engine.

**Fix:** Change the `throw new Error(...)` calls to `throw new LinearClientError(...)` so they're caught by `syncLinearSafe` and produce warning logs instead of being silently swallowed.

## Scope

### In Scope

- Fix all 4 bugs described above
- Update existing unit tests in `tests/go/linear-sync-cli.test.ts`, `tests/go/linear-sync.test.ts`, `tests/spec/linear-sync.test.ts`
- Thread `teamId` through sync functions as needed for state UUID resolution

### Out of Scope

- Integration tests with real Linear API calls
- Adding `linearApiKey` to `.forge.json` config schema
- Refactoring the broader sync architecture
- UI/UX changes to the CLI output beyond the warning message

### Sacred Files

- `src/spec/` — not touched (spec engine creates milestones correctly)
- `skills/` — skill files unchanged
- `hooks/` — hook files unchanged

## Milestones

### Milestone 1: Fix Linear Sync Pipeline

**Goal:** Make the full Linear sync pipeline functional — milestone name resolution, state transitions, error visibility, and error classification all work correctly.

**Issues:**
- [ ] Add stderr warnings for missing LINEAR_API_KEY in CLI adapter functions — modify `cliSyncStart`, `cliSyncComplete`, `cliSyncDone`, `cliFetchIssueIdentifiers` in `linear-sync-cli.ts` to print `[linear-sync] WARN: LINEAR_API_KEY not set` before returning null
- [ ] Fix milestone name resolution to return raw name — change `resolveMilestoneName` in `linear-sync-cli.ts` to return `name` instead of `` `M${milestoneNumber}: ${name}` ``
- [ ] Add state name to UUID resolution for issue transitions — add `resolveStateId` helper in `issues.ts`, thread `teamId` through `transitionMilestoneIssues` and callers in `linear-sync.ts`
- [ ] Fix error class in transitionProject — change `throw new Error(...)` to `throw new LinearClientError(...)` in `projects.ts`
- [ ] Update unit tests for all 4 fixes — update assertions in existing test files to cover new warning output, raw name resolution, state UUID resolution, and error class changes
