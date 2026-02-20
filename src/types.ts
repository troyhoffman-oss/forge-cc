/** Structured error from a verification gate. */
export interface GateError {
  file: string;
  line: number;
  column?: number;
  message: string;
  rule?: string;
}

/** Result of running a single verification gate. */
export interface GateResult {
  gate: string;
  passed: boolean;
  errors: GateError[];
  durationMs: number;
}

/** Full configuration shape matching .forge.json. */
export interface ForgeConfig {
  gates: string[];
  gateTimeouts: Record<string, number>;
  maxIterations: number;
  linearTeam: string;
  linearStates: {
    planned: string;
    inProgress: string;
    inReview: string;
    done: string;
  };
  verifyFreshness: number;
  forgeVersion: string;
}

/** Per-milestone status tracking. */
export interface MilestoneStatus {
  status: 'pending' | 'in_progress' | 'complete';
  linearIssueIds?: string[];
  completedAt?: string;
}

/** PRD status file shape stored in .planning/status/. */
export interface PRDStatus {
  project: string;
  slug: string;
  branch: string;
  createdAt: string;
  linearProjectId?: string;
  linearTeamId?: string;
  milestones: Record<string, MilestoneStatus>;
}

/** Cached verification result. */
export interface VerifyCache {
  timestamp: string;
  result: 'PASSED' | 'FAILED';
  gates: Record<string, { passed: boolean; errors?: GateError[]; summary?: string }>;
}

/** Overall result of a full verification pipeline run. */
export interface PipelineResult {
  result: 'PASSED' | 'FAILED';
  gates: GateResult[];
  durationMs: number;
}
