// Types (re-export as types)
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

// Schemas (re-export values)
export {
  requirementStatusEnum,
  requirementFilesSchema,
  requirementFrontmatterSchema,
  requirementMetaSchema,
  groupDefSchema,
  linearConfigSchema,
  graphIndexSchema,
} from "./schemas.js";

// Reader
export {
  loadGraph,
  loadIndex,
  loadRequirement,
  loadRequirements,
  loadOverview,
  discoverGraphs,
} from "./reader.js";

// Writer
export {
  writeIndex,
  writeRequirement,
  writeOverview,
  initGraph,
  updateRequirementStatus,
  batchUpdateStatus,
  addDiscoveredRequirement,
} from "./writer.js";

// Query
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

// Validator
export {
  validateGraph,
  detectCycles,
  findDanglingEdges,
  findOrphans,
  findFileConflicts,
} from "./validator.js";
