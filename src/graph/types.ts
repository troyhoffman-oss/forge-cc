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
