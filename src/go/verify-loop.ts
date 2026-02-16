import type {
  ForgeConfig,
  GateError,
  GateResult,
  PipelineInput,
  PipelineResult,
} from "../types.js";
import { runPipeline } from "../gates/index.js";

/** Options for the self-healing verification loop */
export interface VerifyLoopOptions {
  projectDir: string;
  config: ForgeConfig;
  /** Override config.maxIterations */
  maxIterations?: number;
  /** Called after each pipeline run with the iteration number and result */
  onIteration?: (iteration: number, result: PipelineResult) => void;
  /**
   * Called when verification fails, giving the caller a chance to fix errors.
   * Returns true if a fix was attempted (loop will re-verify).
   * Returns false or is absent to re-run verification without external fix.
   */
  onFixAttempt?: (
    iteration: number,
    errors: GateError[],
  ) => Promise<boolean>;
}

/** Result from the complete verification loop */
export interface VerifyLoopResult {
  passed: boolean;
  iterations: number;
  maxIterations: number;
  /** All pipeline results across every iteration */
  results: PipelineResult[];
  /** The last pipeline result */
  finalResult: PipelineResult;
  /** Gate names that still fail after all iterations */
  failedGates: string[];
  /** Human-readable summary of remaining errors */
  errorSummary: string;
}

/**
 * Self-healing verification loop.
 *
 * Runs the forge verification pipeline, and on failure either invokes the
 * `onFixAttempt` callback (so the caller can spawn a fix agent) or simply
 * re-runs verification. Loops until the pipeline passes or max iterations
 * are exhausted.
 */
export async function runVerifyLoop(
  options: VerifyLoopOptions,
): Promise<VerifyLoopResult> {
  const {
    projectDir,
    config,
    onIteration,
    onFixAttempt,
  } = options;

  const maxIterations = options.maxIterations ?? config.maxIterations;
  const results: PipelineResult[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const pipelineInput: PipelineInput = {
      projectDir,
      gates: config.gates,
      prdPath: config.prdPath,
      maxIterations,
      devServerCommand: config.devServer?.command,
      devServerPort: config.devServer?.port,
    };

    const result = await runPipeline(pipelineInput);

    // Stamp the iteration number onto the result
    const stamped: PipelineResult = {
      ...result,
      iteration,
      maxIterations,
    };

    results.push(stamped);
    onIteration?.(iteration, stamped);

    // Success — return immediately
    if (stamped.passed) {
      return {
        passed: true,
        iterations: iteration,
        maxIterations,
        results,
        finalResult: stamped,
        failedGates: [],
        errorSummary: "",
      };
    }

    // Not the last iteration — attempt a fix before retrying
    if (iteration < maxIterations) {
      const allErrors = collectErrors(stamped);

      if (onFixAttempt) {
        // Give the caller a chance to fix. Even if it returns false we still
        // loop and re-verify (the caller may have partially fixed things, or
        // an external process may have intervened).
        await onFixAttempt(iteration, allErrors);
      }
    }
  }

  // Exhausted all iterations without passing
  const finalResult = results[results.length - 1]!;
  const failedGates = finalResult.gates
    .filter((g) => !g.passed)
    .map((g) => g.gate);

  return {
    passed: false,
    iterations: maxIterations,
    maxIterations,
    results,
    finalResult,
    failedGates,
    errorSummary: buildErrorSummary(maxIterations, finalResult),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all GateError items from failed gates in a pipeline result */
function collectErrors(result: PipelineResult): GateError[] {
  return result.gates
    .filter((g) => !g.passed)
    .flatMap((g) => g.errors);
}

/**
 * Build a human-readable error summary for a failed verification run.
 *
 * Example output:
 * ```
 * Verification failed after 3 iterations.
 *
 * Failed gates:
 * - types: 2 errors
 *   - src/foo.ts:10: Type 'string' not assignable to 'number'
 *   - src/bar.ts:5: Property 'x' does not exist on type 'Y'
 * - lint: 1 error
 *   - src/baz.ts:20: Unexpected any type
 * ```
 */
function buildErrorSummary(
  iterations: number,
  result: PipelineResult,
): string {
  const lines: string[] = [];

  lines.push(
    `Verification failed after ${iterations} iteration${iterations === 1 ? "" : "s"}.`,
  );
  lines.push("");

  const failedGates = result.gates.filter((g) => !g.passed);
  if (failedGates.length === 0) {
    return lines.join("\n");
  }

  lines.push("Failed gates:");
  for (const gate of failedGates) {
    const errorCount = gate.errors.length;
    lines.push(
      `- ${gate.gate}: ${errorCount} error${errorCount === 1 ? "" : "s"}`,
    );
    for (const err of gate.errors) {
      const location = formatLocation(err);
      const prefix = location ? `${location}: ` : "";
      lines.push(`  - ${prefix}${err.message}`);
    }
  }

  return lines.join("\n");
}

/** Format file:line location string for an error */
function formatLocation(err: GateError): string {
  if (!err.file) return "";
  return err.line ? `${err.file}:${err.line}` : err.file;
}

/**
 * Format gate errors into a structured prompt for a fix agent.
 *
 * The output is designed to be directly usable in an AI agent prompt:
 * it includes file paths, line numbers, error messages, and remediation
 * hints so the agent can locate and fix issues without extra searching.
 */
export function formatErrorsForAgent(result: PipelineResult): string {
  const lines: string[] = [];

  const failedGates = result.gates.filter((g) => !g.passed);

  if (failedGates.length === 0) {
    return "All gates passed. No errors to fix.";
  }

  lines.push("# Verification Errors to Fix");
  lines.push("");

  for (const gate of failedGates) {
    lines.push(`## Gate: ${gate.gate} (${gate.errors.length} errors)`);
    lines.push("");

    if (gate.errors.length === 0) {
      lines.push("Gate failed but reported no structured errors.");
      lines.push("");
      continue;
    }

    for (const err of gate.errors) {
      const location = formatLocation(err);

      if (location) {
        lines.push(`### ${location}`);
      } else {
        lines.push("### (no file location)");
      }

      lines.push(`**Error:** ${err.message}`);

      if (err.remediation) {
        lines.push("");
        lines.push(`> **Remediation:** ${err.remediation}`);
      }

      lines.push("");
    }
  }

  // Add warnings as context (non-blocking but useful for agents)
  const gatesWithWarnings = result.gates.filter(
    (g) => g.warnings.length > 0,
  );
  if (gatesWithWarnings.length > 0) {
    lines.push("## Warnings (non-blocking)");
    lines.push("");
    for (const gate of gatesWithWarnings) {
      for (const warning of gate.warnings) {
        lines.push(`- [${gate.gate}] ${warning}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
