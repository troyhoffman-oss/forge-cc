import type { GateResult, PipelineInput, PipelineResult } from "../types.js";
import { closeBrowser } from "../utils/browser.js";
import { verifyTypes } from "./types-gate.js";
import { verifyLint } from "./lint-gate.js";
import { verifyTests } from "./tests-gate.js";
import { verifyVisual } from "./visual-gate.js";
import { verifyRuntime } from "./runtime-gate.js";
import { verifyPrd } from "./prd-gate.js";

/** Gate registry -- maps gate name to its function */
export const gateRegistry: Record<string, (input: PipelineInput) => Promise<GateResult>> = {
  types: (input) => verifyTypes(input.projectDir),
  lint: (input) => verifyLint(input.projectDir),
  tests: (input) => verifyTests(input.projectDir),
  visual: (input) => verifyVisual(input.projectDir, input.pages ?? [], {
    devServerCommand: input.devServerCommand,
    devServerPort: input.devServerPort,
  }),
  runtime: (input) => verifyRuntime(input.projectDir, input.apiEndpoints ?? [], {
    devServerCommand: input.devServerCommand,
    devServerPort: input.devServerPort,
  }),
  prd: (input) => verifyPrd(input.projectDir, input.prdPath ?? "", input.baseBranch),
};

/** Run the full verification pipeline */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const {
    gates: requestedGates,
    maxIterations = 3,
  } = input;

  // Determine which gates to run
  const gatesToRun = requestedGates ?? ["types", "lint", "tests"];
  const results: GateResult[] = [];

  try {
    for (const gateName of gatesToRun) {
      const gateFn = gateRegistry[gateName];
      if (!gateFn) {
        results.push({
          gate: gateName,
          passed: false,
          errors: [{ message: `Unknown gate: ${gateName}` }],
          warnings: [],
          duration_ms: 0,
        });
        continue;
      }

      const result = await runGateSafe(gateName, () => gateFn(input));
      results.push(result);

      // Early exit: if all core gates (types, lint, tests) fail, skip remaining
      const coreGates = results.filter(r => ["types", "lint", "tests"].includes(r.gate));
      if (coreGates.length === 3 && coreGates.every(r => !r.passed)) {
        // Add skipped gates
        for (const remaining of gatesToRun.slice(gatesToRun.indexOf(gateName) + 1)) {
          results.push({
            gate: remaining,
            passed: false,
            errors: [],
            warnings: ["Skipped due to core gate failures"],
            duration_ms: 0,
          });
        }
        break;
      }
    }
  } finally {
    try { await closeBrowser(); } catch { /* non-fatal */ }
  }

  const passed = results.every(g => g.passed);

  return {
    passed,
    iteration: 1,
    maxIterations,
    gates: results,
    report: "", // Reporter agent in Wave 2 will handle this
  };
}

async function runGateSafe(name: string, fn: () => Promise<GateResult>): Promise<GateResult> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      gate: name,
      passed: false,
      errors: [{ message: `Gate crashed: ${message}` }],
      warnings: [],
      duration_ms: 0,
    };
  }
}

// Re-export individual gates for direct use
export { verifyTypes } from "./types-gate.js";
export { verifyLint } from "./lint-gate.js";
export { verifyTests } from "./tests-gate.js";
export { verifyVisual } from "./visual-gate.js";
export { verifyRuntime } from "./runtime-gate.js";
export { verifyPrd } from "./prd-gate.js";
