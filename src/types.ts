/** Structured error from a verification gate */
export interface GateError {
  file?: string;
  line?: number;
  message: string;
  remediation?: string;
}

/** Result from a single verification gate */
export interface GateResult {
  gate: string;
  passed: boolean;
  errors: GateError[];
  warnings: string[];
  duration_ms: number;
}

/** Extended result for visual validation with screenshots */
export interface VisualResult extends GateResult {
  screenshots: Array<{
    page: string;
    path: string;
  }>;
  consoleErrors: string[];
}

/** Extended result for code review with review-specific metadata */
export interface ReviewResult extends GateResult {
  reviewFindings: Array<{
    type: "prd_compliance" | "rule_violation" | "style";
    severity: "error" | "warning";
    file?: string;
    line?: number;
    message: string;
    remediation: string;
    source: string; // e.g., "PRD: US-2 AC3" or "CLAUDE.md: [agent staging]"
  }>;
}

/** Input for the full verification pipeline */
export interface PipelineInput {
  projectDir: string;
  gates?: string[];
  prdPath?: string;
  milestoneType?: "ui" | "data" | "mixed";
  pages?: string[];
  apiEndpoints?: string[];
  maxIterations?: number;
  devServerCommand?: string;
  devServerPort?: number;
  baseBranch?: string;
  reviewBlocking?: boolean;
}

/** Result from the full verification pipeline */
export interface PipelineResult {
  passed: boolean;
  iteration: number;
  maxIterations: number;
  gates: GateResult[];
  report: string;
}

/** Testing configuration from .forge.json */
export interface TestingConfig {
  enforce: boolean;
  runner: "vitest" | "jest" | "none";
  testDir: string;
  sourceDir: string;
  structural: boolean;
  categories: string[];
}

/** Configuration from .forge.json */
export interface ForgeConfig {
  gates: string[];
  maxIterations: number;
  verifyFreshness: number;
  devServer?: {
    command: string;
    port: number;
    readyPattern?: string;
  };
  prdPath?: string;
  linearProject?: string;
  review?: {
    blocking: boolean;
  };
  testing?: TestingConfig;
}

/** Verification cache written to .forge/last-verify.json */
export interface VerifyCache {
  passed: boolean;
  timestamp: string;
  gates: GateResult[];
  branch: string;
}

/** Viewport configuration for multi-viewport visual capture */
export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

/** Serialized DOM node snapshot from page.evaluate() extraction */
export interface DOMSnapshot {
  tag: string;
  id?: string;
  className?: string;
  visible: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  children: DOMSnapshot[];
}

/** Result from multi-viewport visual capture with DOM extraction */
export interface VisualCaptureResult {
  screenshots: Array<{
    page: string;
    viewport: string;
    path: string;
  }>;
  domSnapshots: Record<string, DOMSnapshot>;
  metadata: {
    viewports: ViewportConfig[];
    pagePath: string;
    capturedAt: string;
    durationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Team types (re-exported from src/team/types.ts)
// ---------------------------------------------------------------------------
export type {
  AgentRole,
  TeamConfig,
  Finding,
  ConsensusRound,
  ConsensusResult,
  TeamReviewResult,
  CodexComment,
} from "./team/types.js";
