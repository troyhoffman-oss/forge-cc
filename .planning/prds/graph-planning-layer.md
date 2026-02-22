# PRD: Graph Planning Layer

## Problem & Goals

Forge uses monolithic markdown PRDs with `### Milestone N:` sections. Agents get regex-extracted slices. Information dies at every handoff — triage agent loses original text, spec agent compresses interview into PRD prose, execution agents get ~2-5K tokens from a ~20K token document. With 1M token context windows, this compression is no longer necessary.

**Goal:** Replace the monolithic PRD format with a graph of atomic requirement files. Each requirement carries its full context (interview notes, technical approach, acceptance criteria). Agents load their assigned requirements + dependencies + project overview instead of a regex-extracted prose section.

**Success criteria:**
- Graph module can read/write atomic requirement files with YAML frontmatter
- Dependency graph supports cycle detection, readiness queries, and wave computation
- All operations are atomic (crash-safe)
- Backward compatible — old milestone system is unmodified

## Technical Approach

- **New module:** `src/graph/` with 7 files (types, schemas, reader, writer, query, validator, index)
- **New dependency:** `yaml` npm package for YAML parsing/serialization
- **File format:** `_index.yaml` for all metadata, individual `.md` files for requirement content
- **Validation:** Zod schemas for data integrity, structural validator for graph integrity
- **Zero coupling** to Linear, git, or the existing milestone system
- **Test fixtures:** Two graph fixtures (valid + invalid) for comprehensive testing

## Scope

### In Scope
- `src/graph/` module with full read/write/query/validate API
- Test fixtures and comprehensive test suite
- `npm install yaml` dependency

### Out of Scope
- Modifying existing milestone system (src/state/status.ts, src/runner/)
- Updating skill files (forge-spec.md, forge-go.md)
- Linear sync integration (future phase)
- CLI command updates (future phase)

### Sacred Files
- `src/state/status.ts` — do not modify
- `src/runner/prompt.ts` — do not modify
- `src/runner/loop.ts` — do not modify
- `src/linear/sync.ts` — do not modify
- `skills/` — do not modify

## Milestones

### Milestone 1: Foundation — Types, Schemas, Reader, Writer
**Goal:** Establish the core data model and file I/O layer. After this milestone, the graph module can read and write all three file formats (_index.yaml, requirement .md files, overview.md) with full schema validation and atomic writes.

**Issues:**
- [ ] Create `src/graph/types.ts` with all TypeScript interfaces (RequirementStatus, Requirement, RequirementMeta, GroupDef, LinearConfig, GraphIndex, ProjectGraph, ValidationError, GroupStatus, ResolvedRequirement, RequirementFiles)
- [ ] Create `src/graph/schemas.ts` with Zod schemas (requirementStatusEnum, requirementFilesSchema, requirementFrontmatterSchema, requirementMetaSchema, groupDefSchema, linearConfigSchema, graphIndexSchema)
- [ ] Install `yaml` npm package and create `src/graph/reader.ts` with loadGraph, loadIndex, loadRequirement, loadRequirements, loadOverview, discoverGraphs — including YAML frontmatter parser
- [ ] Create `src/graph/writer.ts` with writeIndex, writeRequirement, writeOverview, initGraph, updateRequirementStatus, batchUpdateStatus, addDiscoveredRequirement — all using atomic temp-file-and-rename
- [ ] Create test fixtures: `tests/fixtures/sample-graph/` (2 groups, 5 requirements, dependency chain, file conflict) and `tests/fixtures/invalid-graph/` (cycle, dangling edge, orphan, missing group)
- [ ] Create `tests/graph/schemas.test.ts` — 13 test cases covering all schema validation
- [ ] Create `tests/graph/reader.test.ts` — 13 test cases covering loading, discovery, frontmatter parsing
- [ ] Create `tests/graph/writer.test.ts` — 14 test cases covering atomic writes, status updates, round-trips, discovered requirements

**Wave 1 (2 agents parallel):**
1. **types-schemas-agent**: Create `src/graph/types.ts` and `src/graph/schemas.ts`
   - Creates: src/graph/types.ts, src/graph/schemas.ts
2. **fixtures-agent**: Create both test fixture directories with all fixture files
   - Creates: tests/fixtures/sample-graph/_index.yaml, tests/fixtures/sample-graph/overview.md, tests/fixtures/sample-graph/requirements/req-001-setup-project.md, tests/fixtures/sample-graph/requirements/req-002-add-auth.md, tests/fixtures/sample-graph/requirements/req-003-api-endpoints.md, tests/fixtures/sample-graph/requirements/req-004-admin-panel.md, tests/fixtures/sample-graph/requirements/req-005-testing.md, tests/fixtures/invalid-graph/_index.yaml, tests/fixtures/invalid-graph/overview.md, tests/fixtures/invalid-graph/requirements/req-001-cyclic-a.md, tests/fixtures/invalid-graph/requirements/req-002-cyclic-b.md, tests/fixtures/invalid-graph/requirements/req-003-cyclic-c.md, tests/fixtures/invalid-graph/requirements/orphan-file.md

**Wave 2 (2 agents parallel):**
1. **reader-agent**: Create `src/graph/reader.ts` — depends on types.ts and schemas.ts from Wave 1. Install `yaml` package first (`npm install yaml`).
   - Creates: src/graph/reader.ts
   - Modifies: package.json (add yaml dependency)
2. **writer-agent**: Create `src/graph/writer.ts` — depends on types.ts and schemas.ts from Wave 1
   - Creates: src/graph/writer.ts

**Wave 3 (3 agents parallel):**
1. **schemas-test-agent**: Create `tests/graph/schemas.test.ts`
   - Creates: tests/graph/schemas.test.ts
2. **reader-test-agent**: Create `tests/graph/reader.test.ts` — uses sample-graph fixture
   - Creates: tests/graph/reader.test.ts
3. **writer-test-agent**: Create `tests/graph/writer.test.ts` — uses temp directories
   - Creates: tests/graph/writer.test.ts

### Milestone 2: Intelligence — Query Engine and Validator
**dependsOn:** 1
**Goal:** Build the pure-function query layer and structural validator on top of the foundation. After this milestone, the graph module can answer scheduling questions (what's ready? what's blocked? what waves can run in parallel?) and validate graph integrity (cycles, dangling edges, orphans).

**Issues:**
- [ ] Create `src/graph/query.ts` with findReady, findBlocked, getTransitiveDeps, computeWaves, groupStatus, findDiscovered, isProjectComplete, buildRequirementContext
- [ ] Create `src/graph/validator.ts` with validateGraph, detectCycles, findDanglingEdges, findOrphans, findFileConflicts
- [ ] Create `tests/graph/query.test.ts` — 18 test cases covering readiness, blocking, topological sort, wave computation, group status, project completion
- [ ] Create `tests/graph/validator.test.ts` — 9 test cases covering cycles, dangling edges, orphans, file conflicts, full validation

**Wave 1 (2 agents parallel):**
1. **query-agent**: Create `src/graph/query.ts` — all 8 functions. Pure functions operating on in-memory types from types.ts. Key algorithms: topological sort for getTransitiveDeps, greedy bin-packing for computeWaves, group completion aggregation for groupStatus.
   - Creates: src/graph/query.ts
2. **validator-agent**: Create `src/graph/validator.ts` — all 5 functions. DFS cycle detection with white/gray/black coloring. Dangling edge detection by scanning dependsOn against index keys.
   - Creates: src/graph/validator.ts

**Wave 2 (2 agents parallel):**
1. **query-test-agent**: Create `tests/graph/query.test.ts` — uses sample-graph fixture and programmatically constructed indexes for edge cases
   - Creates: tests/graph/query.test.ts
2. **validator-test-agent**: Create `tests/graph/validator.test.ts` — uses invalid-graph fixture plus programmatic test cases
   - Creates: tests/graph/validator.test.ts

### Milestone 3: Integration — Re-exports and Final Verification
**dependsOn:** 1, 2
**Goal:** Wire up the barrel export, run the full test suite, verify type-checking passes, ensure the module is ready for consumption by future phases.

**Issues:**
- [ ] Create `src/graph/index.ts` with all re-exports (types, schemas, reader, writer, query, validator)
- [ ] Run full test suite (`npm test`) and fix any failures
- [ ] Run type checker (`npx tsc --noEmit`) and fix any errors
- [ ] Verify `npm run build` succeeds with the new module included in dist/
