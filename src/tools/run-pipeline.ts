import type { GateResult, PipelineInput, PipelineResult } from "../types.js";
import { closeBrowser } from "../utils/browser.js";
import { generateReport } from "../utils/reporter.js";
import { verifyLint } from "./verify-lint.js";
import { verifyPrd } from "./verify-prd.js";
import { verifyRuntime } from "./verify-runtime.js";
import { verifyTests } from "./verify-tests.js";
import { verifyTypes } from "./verify-types.js";
import { verifyVisual } from "./verify-visual.js";

/**
 * Core pipeline orchestrator. Runs one pass of all applicable verification
 * gates and returns the collected results. The MCP caller handles looping.
 *
 * Gate execution order (sequential):
 * 1. types    — always
 * 2. lint     — always
 * 3. tests    — always
 * 4. visual   — if UI/mixed milestone with pages
 * 5. runtime  — if UI/mixed milestone with endpoints
 * 6. prd      — if prdPath provided
 *
 * Early exit: if gates 1-3 all fail, gates 4-6 are skipped.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const {
    projectDir,
    prdPath,
    milestoneType = "mixed",
    pages = [],
    apiEndpoints = [],
    maxIterations = 3,
    devServerCommand,
    devServerPort = 3000,
    baseBranch,
  } = input;

  const gates: GateResult[] = [];

  try {
    // --- Core gates (always run) ---
    const typesResult = await runGateSafe(() => verifyTypes(projectDir));
    gates.push(typesResult);

    const lintResult = await runGateSafe(() => verifyLint(projectDir));
    gates.push(lintResult);

    const testsResult = await runGateSafe(() => verifyTests(projectDir));
    gates.push(testsResult);

    // --- Early exit check ---
    const coreAllFailed =
      !typesResult.passed && !lintResult.passed && !testsResult.passed;

    if (coreAllFailed) {
      const skipWarning =
        "Skipped visual/runtime/prd gates due to compilation failures";

      // Add placeholder gates so the report shows they were skipped
      if (shouldRunVisual(milestoneType, pages)) {
        gates.push(skippedGate("visual", skipWarning));
      }
      if (shouldRunRuntime(milestoneType, apiEndpoints)) {
        gates.push(skippedGate("runtime", skipWarning));
      }
      if (prdPath) {
        gates.push(skippedGate("prd", skipWarning));
      }
    } else {
      // --- Conditional gates ---

      // Visual gate
      if (shouldRunVisual(milestoneType, pages)) {
        const visualResult = await runGateSafe(() =>
          verifyVisual(projectDir, pages, {
            devServerCommand,
            devServerPort,
          }),
        );
        gates.push(visualResult);
      }

      // Runtime gate
      if (shouldRunRuntime(milestoneType, apiEndpoints)) {
        const runtimeResult = await runGateSafe(() =>
          verifyRuntime(projectDir, apiEndpoints, {
            devServerCommand,
            devServerPort,
          }),
        );
        gates.push(runtimeResult);
      }

      // PRD gate
      if (prdPath) {
        const prdResult = await runGateSafe(() =>
          verifyPrd(projectDir, prdPath, baseBranch),
        );
        gates.push(prdResult);
      }
    }
  } finally {
    // Always clean up browser resources
    try {
      await closeBrowser();
    } catch {
      // Browser cleanup failure is non-fatal
    }
  }

  const passed = gates.every((g) => g.passed);

  const pipelineResult: PipelineResult = {
    passed,
    iteration: 1,
    maxIterations,
    gates,
    report: "",
  };

  // Generate the report with the complete result
  pipelineResult.report = generateReport(pipelineResult);

  return pipelineResult;
}

/**
 * Run a gate function safely, catching any unexpected errors so that
 * a single gate crash does not take down the entire pipeline.
 */
async function runGateSafe(
  fn: () => Promise<GateResult>,
): Promise<GateResult> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      gate: "unknown",
      passed: false,
      errors: [`Gate crashed: ${message}`],
      warnings: [],
      duration_ms: 0,
    };
  }
}

/**
 * Create a placeholder gate result for a skipped gate.
 */
function skippedGate(name: string, reason: string): GateResult {
  return {
    gate: name,
    passed: false,
    errors: [],
    warnings: [reason],
    duration_ms: 0,
  };
}

/**
 * Determine if the visual gate should run.
 */
function shouldRunVisual(
  milestoneType: string,
  pages: string[],
): boolean {
  return (milestoneType === "ui" || milestoneType === "mixed") && pages.length > 0;
}

/**
 * Determine if the runtime gate should run.
 */
function shouldRunRuntime(
  milestoneType: string,
  apiEndpoints: string[],
): boolean {
  return (
    (milestoneType === "ui" || milestoneType === "mixed") &&
    apiEndpoints.length > 0
  );
}
