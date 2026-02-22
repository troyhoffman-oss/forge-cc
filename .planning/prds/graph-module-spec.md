# Graph Module Specification

Blueprint for `src/graph/` — the planning graph that replaces monolithic PRDs.

## Directory Layout

```
.planning/graph/{slug}/
  _index.yaml              # Graph metadata: status, groups, edges, Linear IDs
  overview.md              # Project context: problem, goals, scope, tech approach
  requirements/
    req-001-auth-login.md
    req-002-auth-session.md
    disc-001-rate-limiting.md   # Discovered during execution
```

## Module Layout

```
src/graph/
  types.ts          # TypeScript interfaces
  schemas.ts        # Zod schemas for validation
  reader.ts         # Load graph from disk
  writer.ts         # Write graph to disk (atomic)
  query.ts          # Graph queries (findReady, computeWaves, etc.)
  validator.ts      # Structural validation (cycles, dangling edges, etc.)
  index.ts          # Re-exports
```

---

## File Format: `_index.yaml`

Single source of truth for all graph metadata. Written atomically (temp file + rename).

```yaml
project: "Auth System"
slug: auth-system
branch: feat/auth-system
createdAt: "2026-02-21"

linear:
  projectId: "9b906fc8-d0e0-46dd-a24e-baa4f72df03f"
  teamId: "72baaa3d-a5f7-4400-9011-a5e88f5a787b"

groups:
  authentication:
    name: "Authentication"
    # order omitted — derived from dependency DAG (no deps = goes first)
  api:
    name: "API Layer"
    dependsOn:
      - authentication
  infra:
    name: "Infrastructure"
    order: 1   # Tie-breaker: infra before auth when both are unblocked

requirements:
  req-001:
    group: authentication
    status: pending
    dependsOn: []
  req-002:
    group: authentication
    status: pending
    dependsOn:
      - req-001
    priority: 2              # Higher priority — schedule before req-003
    linearIssueId: "abc-123"
  req-003:
    group: api
    status: pending
    dependsOn:
      - req-001
      - req-002
    linearIssueId: "def-456"
  disc-001:
    group: api
    status: discovered
    dependsOn:
      - req-003
    discoveredBy: "api-builder"
```

### Field Reference

**Top-level fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | yes | Human-readable project name |
| `slug` | string | yes | URL-safe identifier, used for directory naming |
| `branch` | string | yes | Git feature branch name |
| `createdAt` | string | yes | ISO 8601 date |
| `linear` | object | no | Linear integration config |
| `linear.projectId` | string | yes (if linear) | Linear project UUID |
| `linear.teamId` | string | yes (if linear) | Linear team UUID |
| `groups` | Record<string, GroupDef> | yes | Execution groups (replace milestones) |
| `requirements` | Record<string, RequirementMeta> | yes | All requirement metadata |

**GroupDef fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable group name |
| `order` | number | no | Tie-breaker for independent groups (positive integer). If absent, independent groups are ordered alphabetically by key. The scheduler derives primary execution order from the group dependency DAG (topological sort) — `order` only breaks ties between groups with no dependency relationship. |
| `dependsOn` | string[] | no | Group keys that must fully complete before this group starts. Defaults to `[]`. |
| `linearMilestoneId` | string | no | Linear ProjectMilestone UUID |

**RequirementMeta fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `group` | string | yes | Key into `groups` map |
| `status` | enum | yes | `pending`, `in_progress`, `complete`, `discovered`, `rejected` |
| `dependsOn` | string[] | yes | Requirement IDs that must be complete before this one starts |
| `priority` | number | no | Scheduling priority within the ready set. Higher = scheduled first. Default `0`. When `findReady` returns multiple requirements, they are sorted by priority (descending), then group order, then insertion order. |
| `linearIssueId` | string | no | Linear issue UUID |
| `completedAt` | string | no | ISO 8601 timestamp. Set when status transitions to `complete`. |
| `discoveredBy` | string | no | Agent name that created this discovered requirement |
| `rejectedReason` | string | no | Why a discovered requirement was rejected |

### Status Lifecycle

```
Authored requirements:    pending → in_progress → complete
Discovered requirements:  discovered → pending → in_progress → complete
                                     ↘ rejected
```

- `pending` — Ready to be scheduled when dependencies are met
- `in_progress` — Currently being executed by an agent
- `complete` — Done, verified, committed
- `discovered` — Created by an agent mid-execution, awaiting human review
- `rejected` — Human reviewed a discovered requirement and declined it

---

## File Format: Requirement Files

Pure planning documents. No status, no Linear IDs, no execution metadata. Located in `requirements/` subdirectory.

Filename convention: `{id}-{slug}.md` where `{id}` matches the key in `_index.yaml` and `{slug}` is a human-readable suffix. The graph reader identifies requirements by the `id` field in YAML frontmatter, not by filename.

```yaml
---
id: req-001
title: User login with email and password
dependsOn: []
files:
  creates:
    - src/auth/login.ts
    - src/auth/validate.ts
  modifies:
    - src/routes/index.ts
acceptance:
  - User can log in with valid email and password
  - Invalid credentials return 401 with error message
  - Session token is set as httpOnly cookie on success
  - Login endpoint is rate-limited to 5 attempts per minute
---

## Context

The app currently has no authentication. Users access all routes anonymously.
This is the first requirement in the auth group — session management (req-002)
depends on this login flow being in place.

## Technical Approach

Use bcrypt for password hashing (already in package.json dependencies).
POST /api/auth/login endpoint. Validate email format and password length
server-side before hitting the database. Return a signed JWT stored in an
httpOnly cookie — do not use localStorage.

The existing user table in schema.prisma has email and passwordHash columns
but no login route wired up yet.

## Interview Notes

User wants email/password auth only — no OAuth for v1. Rate limiting was
added during the scope discussion after the user mentioned past brute-force
attempts on their staging environment. The 5-attempt-per-minute limit was
their suggestion.
```

### Field Reference

**YAML frontmatter:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier. Must match the key in `_index.yaml`. Convention: `req-NNN` for authored, `disc-NNN` for discovered. |
| `title` | string | yes | Human-readable requirement title. One sentence. |
| `dependsOn` | string[] | no | **Informational mirror** of the authoritative `dependsOn` in `_index.yaml`. Included for human readability — when Troy opens a requirement file in his editor, he can see its dependencies without opening the index. The graph reader **ignores** this field; the index is the source of truth. The `forge:spec` skill writes both locations; they should be kept in sync by convention. |
| `files` | object | no | Scope declaration for file ownership. **Note:** These are best-effort estimates from spec time. Agents may create or modify files not listed here. The `computeWaves` scheduler uses these for initial conflict detection but accepts runtime overrides from the orchestrator. |
| `files.creates` | string[] | no | Files this requirement will create. Defaults to `[]`. |
| `files.modifies` | string[] | no | Files this requirement will modify. Defaults to `[]`. |
| `acceptance` | string[] | yes | Acceptance criteria. Each item is a testable statement. |

**Markdown body sections (all optional, order matters for consistency):**

| Section | Purpose |
|---------|---------|
| `## Context` | Why this requirement exists. Problem it solves. User story it satisfies. |
| `## Technical Approach` | How to implement. Stack decisions, patterns, code dependencies, edge cases. |
| `## Interview Notes` | Original context from the spec interview. Preserved verbatim from Q&A. |

Discovered requirements (`disc-NNN`) follow the same format but are created by agents during execution. They may have thinner bodies (no Interview Notes section) since they originate from implementation discoveries, not user interviews.

---

## File Format: `overview.md`

Project-level context. Persisted from codebase scan + spec interview. Read by all agents for project understanding. Plain markdown, no YAML frontmatter.

**Lifecycle:** Written once during `forge:spec`. May be updated during execution if agents discover that the technical approach was wrong or new architectural constraints emerge. The `writeOverview` function supports this — the orchestrator or a fix agent can update the overview between execution rounds. However, this should be rare; most execution discoveries create new requirement files (`disc-NNN`) rather than modifying the overview.

```markdown
# Auth System

## Problem & Goals

The application has no authentication. All routes are publicly accessible.
Users have requested login capability since launch. This is blocking the
rollout of user-specific features (saved preferences, history, profiles).

**Success criteria:**
- Users can create accounts, log in, and maintain sessions
- API routes are protected — unauthenticated requests return 401
- Session management is secure (httpOnly cookies, token rotation)

## User Stories

**Primary user: End user**
1. User navigates to /login, enters email and password, clicks "Log in"
2. On success: redirected to dashboard with session active
3. On failure: sees inline error message, can retry

**Secondary user: Admin**
1. Admin can view active sessions in /admin/sessions
2. Admin can revoke any session

## Technical Approach

- **Framework:** Next.js 14 (App Router) with TypeScript
- **Database:** PostgreSQL via Prisma ORM (schema.prisma exists)
- **Auth:** JWT in httpOnly cookies, bcrypt password hashing
- **Key files:** src/lib/auth.ts (new), src/middleware.ts (modify for auth guard)
- **Dependencies:** bcrypt (already installed), jsonwebtoken (add)

## Scope

### In Scope
- Email/password authentication (login, logout, session management)
- API route protection middleware
- Basic admin session viewer

### Out of Scope
- OAuth/social login (deferred to v2)
- Password reset flow (deferred)
- 2FA/MFA

### Sacred Files
- src/db/schema.prisma (modify only to add auth tables — do not restructure)
- next.config.js (do not modify)
```

---

## TypeScript Types — `src/graph/types.ts`

```typescript
/** Requirement status lifecycle. */
export type RequirementStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "discovered"
  | "rejected";

/** Scope declaration: which files a requirement creates or modifies. */
export interface RequirementFiles {
  creates: string[];
  modifies: string[];
}

/** Requirement content parsed from a .md file in requirements/. */
export interface Requirement {
  /** Unique identifier. Must match key in GraphIndex.requirements. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Informational mirror of dependsOn from the index. For human readability only — the graph reader ignores this; the index is authoritative. */
  dependsOn?: string[];
  /** File scope declaration. Best-effort estimates from spec time. */
  files: RequirementFiles;
  /** Acceptance criteria — each item is a testable statement. */
  acceptance: string[];
  /** Full markdown body below the YAML frontmatter. */
  body: string;
}

/** Requirement metadata stored in _index.yaml. */
export interface RequirementMeta {
  /** Key into GraphIndex.groups. */
  group: string;
  /** Current lifecycle status. */
  status: RequirementStatus;
  /** Requirement IDs that must be complete before this one starts. */
  dependsOn: string[];
  /** Scheduling priority. Higher = scheduled first. Default 0. */
  priority?: number;
  /** Linear issue UUID. */
  linearIssueId?: string;
  /** ISO 8601 timestamp — set when status transitions to complete. */
  completedAt?: string;
  /** Agent name — set when an agent creates a discovered requirement. */
  discoveredBy?: string;
  /** Reason — set when a discovered requirement is rejected. */
  rejectedReason?: string;
}

/** Group definition — organizational grouping that replaces milestones. */
export interface GroupDef {
  /** Human-readable group name. */
  name: string;
  /** Tie-breaker for independent groups. Primary order is derived from the dependency DAG. */
  order?: number;
  /** Group keys that must fully complete before this group starts. */
  dependsOn?: string[];
  /** Linear ProjectMilestone UUID. */
  linearMilestoneId?: string;
}

/** Linear integration configuration. */
export interface LinearConfig {
  /** Linear project UUID. */
  projectId: string;
  /** Linear team UUID. */
  teamId: string;
}

/** Full _index.yaml structure — single source of truth for graph metadata. */
export interface GraphIndex {
  /** Human-readable project name. */
  project: string;
  /** URL-safe identifier, used for directory naming. */
  slug: string;
  /** Git feature branch name. */
  branch: string;
  /** ISO 8601 creation date. */
  createdAt: string;
  /** Linear integration config. Absent if Linear is not configured. */
  linear?: LinearConfig;
  /** Execution groups (organizational, replaces milestones). */
  groups: Record<string, GroupDef>;
  /** All requirement metadata. Keyed by requirement ID. */
  requirements: Record<string, RequirementMeta>;
}

/** Resolved requirement = content + metadata joined from file + index. */
export interface ResolvedRequirement {
  /** Requirement content from the .md file. */
  content: Requirement;
  /** Requirement metadata from _index.yaml. */
  meta: RequirementMeta;
}

/** The full project graph — index + overview + all requirement content. */
export interface ProjectGraph {
  /** Parsed _index.yaml. */
  index: GraphIndex;
  /** Raw markdown content of overview.md. */
  overview: string;
  /** Requirement content keyed by ID. */
  requirements: Map<string, Requirement>;
}

/** Structural validation error. */
export interface ValidationError {
  type:
    | "cycle"
    | "dangling_dep"
    | "missing_file"
    | "orphan_requirement"
    | "unknown_group"
    | "duplicate_id"
    | "schema_error"
    | "file_conflict";
  message: string;
  /** Contextual data — varies by error type. */
  context: Record<string, unknown>;
}

/** Group completion summary. */
export interface GroupStatus {
  total: number;
  complete: number;
  inProgress: number;
  pending: number;
  discovered: number;
  rejected: number;
  isComplete: boolean;
}
```

---

## Zod Schemas — `src/graph/schemas.ts`

```typescript
import { z } from "zod";

export const requirementStatusEnum = z.enum([
  "pending",
  "in_progress",
  "complete",
  "discovered",
  "rejected",
]);

export const requirementFilesSchema = z.object({
  creates: z.array(z.string()).default([]),
  modifies: z.array(z.string()).default([]),
});

/** Validates YAML frontmatter of a requirement .md file. */
export const requirementFrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  dependsOn: z.array(z.string()).optional(), // Informational mirror — ignored by graph reader
  files: requirementFilesSchema.default({ creates: [], modifies: [] }),
  acceptance: z.array(z.string()).min(1),
});

/** Validates a single requirement entry in _index.yaml. */
export const requirementMetaSchema = z.object({
  group: z.string().min(1),
  status: requirementStatusEnum,
  dependsOn: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  linearIssueId: z.string().optional(),
  completedAt: z.string().optional(),
  discoveredBy: z.string().optional(),
  rejectedReason: z.string().optional(),
});

/** Validates a group definition in _index.yaml. */
export const groupDefSchema = z.object({
  name: z.string().min(1),
  order: z.number().int().positive().optional(),
  dependsOn: z.array(z.string()).default([]),
  linearMilestoneId: z.string().optional(),
});

/** Validates the linear config block in _index.yaml. */
export const linearConfigSchema = z.object({
  projectId: z.string().min(1),
  teamId: z.string().min(1),
});

/** Validates the full _index.yaml structure. */
export const graphIndexSchema = z.object({
  project: z.string().min(1),
  slug: z.string().min(1),
  branch: z.string().min(1),
  createdAt: z.string().min(1),
  linear: linearConfigSchema.optional(),
  groups: z.record(z.string(), groupDefSchema),
  requirements: z.record(z.string(), requirementMetaSchema),
});
```

---

## Public API — `src/graph/reader.ts`

**YAML is the format. Use the `yaml` npm package (zero dependencies, ~150KB).**

The `_index.yaml` is the file Troy and team will open most often — human
readability matters. The frontmatter schema has nested objects
(`files.creates`) and arrays that are tedious to parse by hand. Add `yaml`
to `dependencies` in package.json.

For requirement files, the YAML frontmatter is delimited by `---` lines.
Parse by splitting on the first two `---` markers and using `yaml.parse()`.

```typescript
import type {
  GraphIndex,
  Requirement,
  ProjectGraph,
} from "./types.js";

/**
 * Load the complete project graph from disk.
 *
 * Reads _index.yaml, overview.md, and all .md files in requirements/.
 * Validates _index with Zod schema. Validates each requirement frontmatter.
 * Does NOT validate graph structure (cycles, dangling edges) — use validator for that.
 *
 * @throws On missing _index file, schema validation failure, or missing overview.md.
 */
export async function loadGraph(
  projectDir: string,
  slug: string,
): Promise<ProjectGraph>;

/**
 * Load only the graph index (_index.yaml).
 *
 * Fast path for status checks and queries that don't need requirement content.
 * Most query.ts functions operate on GraphIndex alone.
 *
 * @throws On missing file or schema validation failure.
 */
export async function loadIndex(
  projectDir: string,
  slug: string,
): Promise<GraphIndex>;

/**
 * Load a single requirement file by ID.
 *
 * Scans all .md files in requirements/ for a frontmatter `id` match.
 * Returns null if no file has a matching ID.
 */
export async function loadRequirement(
  projectDir: string,
  slug: string,
  id: string,
): Promise<Requirement | null>;

/**
 * Load multiple requirement files by ID.
 *
 * More efficient than calling loadRequirement N times — reads the directory once.
 * Returns a Map keyed by ID. Missing IDs are absent from the map.
 */
export async function loadRequirements(
  projectDir: string,
  slug: string,
  ids: string[],
): Promise<Map<string, Requirement>>;

/**
 * Load the overview.md content.
 *
 * @throws If overview.md does not exist.
 */
export async function loadOverview(
  projectDir: string,
  slug: string,
): Promise<string>;

/**
 * Discover all graph directories in .planning/graph/.
 *
 * Returns slug names for each valid graph (has _index file).
 * Skips directories without a valid index.
 */
export async function discoverGraphs(
  projectDir: string,
): Promise<string[]>;
```

---

## Public API — `src/graph/writer.ts`

All write operations use atomic temp-file-and-rename, consistent with the
existing `writeStatus()` pattern in `src/state/status.ts`.

```typescript
import type {
  GraphIndex,
  Requirement,
  RequirementStatus,
} from "./types.js";

/**
 * Write the graph index atomically (temp file + rename).
 *
 * Serializes to YAML and writes to _index.yaml.
 * Creates the graph directory if it does not exist.
 */
export async function writeIndex(
  projectDir: string,
  slug: string,
  index: GraphIndex,
): Promise<void>;

/**
 * Write a single requirement file.
 *
 * Serializes YAML frontmatter + markdown body.
 * Creates the requirements/ directory if it does not exist.
 * Overwrites if a file with the same ID already exists.
 */
export async function writeRequirement(
  projectDir: string,
  slug: string,
  req: Requirement,
): Promise<void>;

/**
 * Write the overview.md file.
 *
 * Creates the graph directory if it does not exist.
 */
export async function writeOverview(
  projectDir: string,
  slug: string,
  content: string,
): Promise<void>;

/**
 * Initialize a new graph directory structure.
 *
 * Creates:
 *   .planning/graph/{slug}/
 *   .planning/graph/{slug}/_index.yaml
 *   .planning/graph/{slug}/overview.md
 *   .planning/graph/{slug}/requirements/
 *
 * Writes the index and overview. Does NOT write requirement files —
 * call writeRequirement() for each after init.
 *
 * @throws If the graph directory already exists.
 */
export async function initGraph(
  projectDir: string,
  slug: string,
  index: GraphIndex,
  overview: string,
): Promise<void>;

/**
 * Update a single requirement's status in the index.
 *
 * Atomic read-modify-write on _index.yaml.
 * Sets completedAt when transitioning to "complete".
 *
 * @returns The updated GraphIndex.
 * @throws If the requirement ID is not found in the index.
 */
export async function updateRequirementStatus(
  projectDir: string,
  slug: string,
  requirementId: string,
  status: RequirementStatus,
): Promise<GraphIndex>;

/**
 * Batch-update multiple requirement statuses.
 *
 * Single atomic read-modify-write. More efficient than N individual calls.
 *
 * @returns The updated GraphIndex.
 * @throws If any requirement ID is not found in the index.
 */
export async function batchUpdateStatus(
  projectDir: string,
  slug: string,
  updates: Array<{ id: string; status: RequirementStatus }>,
): Promise<GraphIndex>;

/**
 * Add a discovered requirement.
 *
 * Updates the index first (with metadata pointing to a file that doesn't
 * exist yet), then writes the requirement file. This ordering is intentional:
 * if the process crashes between the two operations, an index entry pointing
 * to a missing file is a detectable, recoverable state (caught by
 * `validateGraph` as a `missing_file` error). An orphan file with no index
 * entry would be invisible to the graph.
 *
 * The ID must not already exist in the index.
 *
 * @returns The updated GraphIndex.
 * @throws If the ID already exists.
 */
export async function addDiscoveredRequirement(
  projectDir: string,
  slug: string,
  req: Requirement,
  meta: {
    group: string;
    dependsOn: string[];
    discoveredBy: string;
  },
): Promise<GraphIndex>;
```

---

## Public API — `src/graph/query.ts`

All query functions are **pure** — they operate on in-memory data structures,
not on disk. Load the graph or index first, then query.

```typescript
import type {
  GraphIndex,
  Requirement,
  GroupStatus,
} from "./types.js";

/**
 * Find all requirements ready to execute.
 *
 * A requirement is ready when:
 * 1. Its status is "pending"
 * 2. All requirements in its dependsOn are "complete"
 * 3. All group-level dependsOn groups are fully complete
 *    (every requirement in the depended group has status "complete")
 *
 * Returns requirement IDs sorted by: priority (descending), then group
 * order (from dependency DAG + tie-breaker), then insertion order within
 * the group.
 */
export function findReady(index: GraphIndex): string[];

/**
 * Find all requirements that are blocked.
 *
 * A requirement is blocked when:
 * - status is "pending"
 * - At least one dependsOn requirement is NOT "complete", OR
 * - Its group has a dependsOn group that is not fully complete
 *
 * Returns each blocked requirement with its unresolved blockers.
 */
export function findBlocked(
  index: GraphIndex,
): Array<{ id: string; blockedBy: string[] }>;

/**
 * Get a requirement and all its transitive dependencies.
 *
 * Traverses the dependsOn graph recursively. Returns IDs in
 * topological order (dependencies first, target last).
 *
 * Used for building agent prompts: the agent receives its requirement
 * plus all upstream requirements for context.
 *
 * @throws If a cycle is detected during traversal.
 */
export function getTransitiveDeps(
  index: GraphIndex,
  id: string,
): string[];

/**
 * Group ready requirements into parallel execution waves.
 *
 * Two requirements CANNOT be in the same wave if they share any file
 * in their creates or modifies lists. This prevents parallel agents
 * from conflicting on the same files.
 *
 * Algorithm:
 * 1. Build a conflict graph: edge between two requirements if they share a file
 * 2. Greedy wave assignment: for each requirement (in group-order), assign to
 *    the first wave where it has no conflicts
 *
 * @param readyIds - Output of findReady()
 * @param requirements - Requirement content (need files for conflict detection)
 * @param fileOverrides - Optional map of requirement ID → observed file lists.
 *        The orchestrator populates this from runtime observation (what agents
 *        actually touched in previous waves). When present, overrides the
 *        declared `files` in the requirement content for conflict detection.
 *        This handles the "files field is optimistic" problem — spec-time
 *        estimates may be wrong, but the orchestrator learns the real file
 *        scope during execution.
 * @returns Array of waves. Each wave is an array of requirement IDs that can
 *          execute in parallel.
 */
export function computeWaves(
  readyIds: string[],
  requirements: Map<string, Requirement>,
  fileOverrides?: Map<string, RequirementFiles>,
): string[][];

/**
 * Compute completion status for each group.
 *
 * Counts requirements by status within each group. A group isComplete
 * when every requirement in it (excluding rejected) has status "complete".
 */
export function groupStatus(
  index: GraphIndex,
): Record<string, GroupStatus>;

/**
 * Get all requirements with status "discovered" (awaiting human review).
 */
export function findDiscovered(index: GraphIndex): string[];

/**
 * Check if the project is complete.
 *
 * True when every requirement with status other than "rejected"
 * has status "complete".
 */
export function isProjectComplete(index: GraphIndex): boolean;

/**
 * Build the context payload for an agent prompt.
 *
 * Given a requirement ID, returns:
 * - The requirement's own content
 * - All transitive dependency requirement contents
 * - Sorted in topological order (dependencies first)
 *
 * The caller (prompt builder) combines this with the overview
 * to build the full agent prompt.
 */
export function buildRequirementContext(
  index: GraphIndex,
  requirements: Map<string, Requirement>,
  targetId: string,
): Requirement[];
```

---

## Public API — `src/graph/validator.ts`

Validation runs after loading a graph. Returns all errors found (does not
throw on first error).

```typescript
import type {
  ProjectGraph,
  GraphIndex,
  Requirement,
  ValidationError,
} from "./types.js";

/**
 * Validate the full graph structure.
 *
 * Runs all structural checks:
 * 1. No dependency cycles (requirement-level and group-level)
 * 2. No dangling edges (dependsOn references to non-existent IDs)
 * 3. Every requirement in the index has a corresponding .md file
 * 4. No orphan requirement files (files not listed in the index)
 * 5. Every requirement's group exists in the groups map
 * 6. No duplicate IDs across requirement files
 * 7. Zod schema validation on index and all requirement frontmatter
 *
 * @returns Array of ValidationError. Empty array means the graph is valid.
 */
export function validateGraph(graph: ProjectGraph): ValidationError[];

/**
 * Check for dependency cycles in the requirement graph.
 *
 * Uses depth-first search with coloring (white/gray/black).
 * Returns the cycle path if found (array of IDs forming the cycle),
 * or null if the graph is acyclic.
 *
 * Also checks group-level dependsOn for cycles.
 */
export function detectCycles(index: GraphIndex): string[] | null;

/**
 * Find dangling dependency edges.
 *
 * A dangling edge is a dependsOn entry that references a requirement ID
 * not present in the index, or a group dependsOn that references a group
 * key not present in the groups map.
 */
export function findDanglingEdges(
  index: GraphIndex,
): Array<{ from: string; to: string; level: "requirement" | "group" }>;

/**
 * Find orphan requirement files.
 *
 * Requirement files in the requirements/ directory whose frontmatter ID
 * does not match any key in the index.
 */
export function findOrphans(graph: ProjectGraph): string[];

/**
 * Find file conflicts between requirements that could be scheduled in parallel.
 *
 * Two requirements conflict if they share a file in creates or modifies
 * AND they could theoretically run in the same wave (same group, no
 * dependsOn relationship between them).
 *
 * This is informational — the wave scheduler handles conflicts automatically.
 * But it's useful for the spec author to see potential parallelism limits.
 */
export function findFileConflicts(
  requirements: Map<string, Requirement>,
  index: GraphIndex,
): Array<{ file: string; requirements: string[] }>;
```

---

## Re-exports — `src/graph/index.ts`

```typescript
export type {
  RequirementStatus,
  RequirementFiles,
  Requirement,
  RequirementMeta,
  GroupDef,
  LinearConfig,
  GraphIndex,
  ResolvedRequirement,
  ProjectGraph,
  ValidationError,
  GroupStatus,
} from "./types.js";

export {
  requirementStatusEnum,
  requirementFrontmatterSchema,
  requirementMetaSchema,
  groupDefSchema,
  linearConfigSchema,
  graphIndexSchema,
} from "./schemas.js";

export {
  loadGraph,
  loadIndex,
  loadRequirement,
  loadRequirements,
  loadOverview,
  discoverGraphs,
} from "./reader.js";

export {
  writeIndex,
  writeRequirement,
  writeOverview,
  initGraph,
  updateRequirementStatus,
  batchUpdateStatus,
  addDiscoveredRequirement,
} from "./writer.js";

export {
  findReady,
  findBlocked,
  getTransitiveDeps,
  computeWaves,
  groupStatus,
  findDiscovered,
  isProjectComplete,
  buildRequirementContext,
} from "./query.js";

export {
  validateGraph,
  detectCycles,
  findDanglingEdges,
  findOrphans,
  findFileConflicts,
} from "./validator.js";
```

---

## YAML Frontmatter Parsing

Requirement files use `---` delimited YAML frontmatter (standard convention).

**Parse algorithm:**
1. Read file as UTF-8 string
2. Assert the file starts with `---\n`
3. Find the second `---\n` delimiter
4. Extract the text between delimiters as YAML
5. Parse YAML into an object
6. Validate with `requirementFrontmatterSchema`
7. Everything after the second `---\n` delimiter is the markdown body

**YAML dependency:** Use the `yaml` npm package for both `_index.yaml` and
frontmatter parsing. See Implementation Notes.

---

## Path Conventions

All path functions should use these conventions, consistent with the existing
codebase:

```typescript
/** Root directory for all graphs. */
function graphRoot(projectDir: string): string {
  return join(projectDir, ".planning", "graph");
}

/** Directory for a specific graph. */
function graphDir(projectDir: string, slug: string): string {
  return join(graphRoot(projectDir), slug);
}

/** Path to the graph index file. */
function indexPath(projectDir: string, slug: string): string {
  return join(graphDir(projectDir, slug), "_index.yaml");
}

/** Path to the overview file. */
function overviewPath(projectDir: string, slug: string): string {
  return join(graphDir(projectDir, slug), "overview.md");
}

/** Directory containing requirement files. */
function requirementsDir(projectDir: string, slug: string): string {
  return join(graphDir(projectDir, slug), "requirements");
}
```

---

## Error Handling Conventions

Consistent with the existing codebase patterns:

| Situation | Behavior |
|-----------|----------|
| File not found (index, overview) | Throw (these are required) |
| File not found (single requirement) | Return null |
| Schema validation failure | Throw (Zod parse, same as status.ts) |
| Structural validation (cycles, etc.) | Return ValidationError[] (batch, don't throw) |
| Atomic write failure | Throw (file system error) |
| Requirement ID not found in index | Throw (programmer error) |
| Graph directory already exists (initGraph) | Throw |

---

## Test Plan

Test file location: `tests/graph/` mirroring the module structure.

### `tests/graph/schemas.test.ts`
- Valid requirement frontmatter passes validation
- Frontmatter `dependsOn` is optional (passes when omitted)
- Missing `id` rejects
- Missing `acceptance` rejects
- Empty `acceptance` array rejects
- `files` defaults to empty arrays when omitted
- Valid graph index passes validation
- Missing `project`, `slug`, or `branch` rejects
- Invalid requirement status enum rejects
- `priority` defaults to 0 when omitted
- Valid group definition passes
- Group `order` is optional (passes when omitted)
- Group `order` must be positive integer when present

### `tests/graph/reader.test.ts`
- `loadGraph` returns full graph with index, overview, and requirements
- `loadGraph` throws on missing index file
- `loadGraph` throws on invalid index schema
- `loadIndex` returns parsed and validated index
- `loadRequirement` returns requirement by ID
- `loadRequirement` returns null for unknown ID
- `loadRequirements` returns Map of multiple requirements
- `loadOverview` returns overview content
- `discoverGraphs` finds all valid graph directories
- `discoverGraphs` skips directories without valid index
- `discoverGraphs` returns empty array when no graph directory exists
- Frontmatter parsing handles multiline arrays correctly
- Frontmatter parsing handles nested `files` object

### `tests/graph/writer.test.ts`
- `writeIndex` creates directory and writes file
- `writeIndex` atomic write (no temp files remain)
- `writeRequirement` creates requirements directory
- `writeRequirement` serializes frontmatter + body correctly
- `writeOverview` writes overview content
- `initGraph` creates full directory structure
- `initGraph` throws if directory exists
- `updateRequirementStatus` reads, updates, and writes back
- `updateRequirementStatus` sets completedAt on complete
- `updateRequirementStatus` throws on unknown ID
- `batchUpdateStatus` updates multiple in single write
- `addDiscoveredRequirement` writes index before file (crash safety)
- `addDiscoveredRequirement` throws on duplicate ID
- Round-trip: write then read returns identical data

### `tests/graph/query.test.ts`
- `findReady` returns requirements with all deps complete
- `findReady` respects group-level dependsOn
- `findReady` sorts by priority descending, then group order, then insertion order
- `findReady` returns empty when all requirements are complete
- `findReady` returns empty when all pending requirements are blocked
- `findBlocked` returns pending requirements with unmet deps
- `findBlocked` includes group-level blockers
- `getTransitiveDeps` returns topological order
- `getTransitiveDeps` throws on cycle
- `getTransitiveDeps` handles diamond dependencies (A→B, A→C, B→D, C→D)
- `computeWaves` separates requirements with file conflicts
- `computeWaves` groups non-conflicting requirements together
- `computeWaves` returns single wave when no conflicts
- `computeWaves` respects fileOverrides when provided
- `computeWaves` falls back to declared files when no override exists
- `groupStatus` counts statuses correctly
- `groupStatus` marks group complete when all non-rejected are complete
- `findDiscovered` returns only discovered requirements
- `isProjectComplete` true when all non-rejected complete
- `isProjectComplete` false when any pending/in_progress remain
- `buildRequirementContext` returns target + deps in topological order

### `tests/graph/validator.test.ts`
- `validateGraph` returns empty for valid graph
- `detectCycles` finds requirement-level cycle (A→B→C→A)
- `detectCycles` finds group-level cycle
- `detectCycles` returns null for acyclic graph
- `findDanglingEdges` finds missing requirement references
- `findDanglingEdges` finds missing group references
- `findOrphans` finds files not in index
- `findFileConflicts` finds shared files between parallel requirements
- Full validation catches all error types simultaneously

### Test fixtures

Create a test fixture graph at `tests/fixtures/sample-graph/` with:
- `_index.yaml` with 2 groups and 5 requirements
- `overview.md` with sample project context
- 5 requirement files with varying status and dependencies
- At least one dependency chain (req-003 depends on req-001, req-002)
- At least one file conflict (req-002 and req-004 both modify same file)

Create a second fixture `tests/fixtures/invalid-graph/` with:
- Cycle in dependencies
- Dangling edge
- Orphan requirement file
- Missing group reference

---

## Implementation Notes

1. **Add `yaml` as a dependency.** Run `npm install yaml`. The package is
   zero-dependency, ~150KB, and widely used. It handles both `_index.yaml`
   parsing/serialization and requirement frontmatter parsing.

2. **Backward compatibility.** This module is additive. It does not modify or
   replace `src/state/status.ts`. The old milestone system continues to work.
   Integration happens in later phases when `runner/prompt.ts` and
   `runner/loop.ts` are updated to use the graph module.

3. **The graph module has zero coupling to Linear.** Linear IDs are stored in
   the index as opaque strings. The graph module never calls the Linear API.
   Linear sync is handled by `src/linear/sync.ts` which reads IDs from the
   index via the graph reader.

4. **The graph module has zero coupling to git.** The `branch` field in the
   index is metadata for other modules. The graph module reads and writes
   files — it does not interact with git.

5. **Import paths use `.js` extension** per the project's ES module convention
   and tsconfig (`module: "Node16"`).

6. **Group ordering is DAG-derived.** The scheduler topologically sorts
   groups by their `dependsOn` edges. The optional `order` field is only a
   tie-breaker for groups with no dependency relationship. If `order` is
   absent on all groups, ties are broken alphabetically by group key.

7. **The `dependsOn` in requirement frontmatter is informational.** The graph
   reader parses it (so it's in the `Requirement` type) but never uses it for
   graph queries. All dependency logic reads from `_index.yaml`. The
   `forge:spec` skill writes both locations for human convenience. The
   validator does NOT check that frontmatter `dependsOn` matches the index —
   they may drift, and that's acceptable.
