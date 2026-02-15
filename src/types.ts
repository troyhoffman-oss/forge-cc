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
}

/** Result from the full verification pipeline */
export interface PipelineResult {
  passed: boolean;
  iteration: number;
  maxIterations: number;
  gates: GateResult[];
  report: string;
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
}

/** Verification cache written to .forge/last-verify.json */
export interface VerifyCache {
  passed: boolean;
  timestamp: string;
  gates: GateResult[];
  branch: string;
}
