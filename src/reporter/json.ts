import type { PipelineResult } from "../types.js";

export function formatJsonReport(result: PipelineResult): string {
  return JSON.stringify(result, null, 2);
}
