/** Result from a single verification gate */
export interface GateResult {
  gate: string;
  passed: boolean;
  errors: string[];
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
