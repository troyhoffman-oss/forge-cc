import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ForgeConfig,
  GateError,
  PipelineInput,
  PipelineResult,
  Finding,
  TeamReviewResult,
} from "../types.js";
import { runPipeline } from "../gates/index.js";
import { reviewWaveDiff } from "../team/reviewer.js";
import {
  runConsensusProtocol,
  escalateToExecutive,
  createConsensusState,
  recordBuilderResponse,
} from "../team/consensus.js";
import type { BuilderResponse, EscalationDecision } from "../team/consensus.js";

/** Configuration for team-based review after mechanical gates pass */
export interface ReviewerConfig {
  projectDir: string;
  prdPath?: string;
  baseBranch?: string;
  /** Callback to get builder responses for findings. The skill drives this via SendMessage. */
  onBuilderResponses?: (findings: Finding[]) => Promise<Map<string, BuilderResponse[]>>;
  /** Callback for unresolved escalations. Executive makes the call. */
  onEscalation?: (findings: Finding[]) => Promise<EscalationDecision[]>;
}

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
  /** Configuration for team-based review after mechanical gates pass */
  reviewerConfig?: ReviewerConfig;
  /** Called when review findings and consensus are complete */
  onReviewComplete?: (reviewResult: TeamReviewResult) => void;
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
  /** Review findings from the team reviewer (only present when reviewerConfig is provided) */
  reviewFindings?: TeamReviewResult;
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
    reviewerConfig,
    onReviewComplete,
  } = options;

  const maxIterations = options.maxIterations ?? config.maxIterations;
  const results: PipelineResult[] = [];

  // Snapshot .forge.json before the loop to detect unauthorized config mutation
  const configPath = join(projectDir, ".forge.json");
  let configSnapshot: string | null = null;
  try {
    configSnapshot = readFileSync(configPath, "utf-8");
  } catch {
    // .forge.json may not exist — skip detection
  }

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

    // Success — mechanical gates passed
    if (stamped.passed) {
      // If reviewer is configured, run team-based review before declaring success
      if (reviewerConfig) {
        const reviewResult = await runTeamReview(
          reviewerConfig,
          onFixAttempt,
          onReviewComplete,
          iteration,
        );

        // If review found accepted errors that need fixing, continue the loop
        if (reviewResult.hasAcceptedErrors && iteration < maxIterations) {
          // Convert accepted findings to GateErrors for the fix callback
          const fixErrors = findingsToGateErrors(reviewResult.acceptedFindings);
          if (onFixAttempt) {
            await onFixAttempt(iteration, fixErrors);
          }
          // Continue the loop to re-verify after fixes
          continue;
        }

        // No accepted errors or at max iterations — return with review data
        return {
          passed: true,
          iterations: iteration,
          maxIterations,
          results,
          finalResult: stamped,
          failedGates: [],
          errorSummary: "",
          reviewFindings: reviewResult.teamReviewResult,
        };
      }

      // No reviewer configured — return immediately
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

        // Guard: detect if the fix agent mutated .forge.json (gate removal, etc.)
        if (configSnapshot !== null) {
          try {
            const currentConfig = readFileSync(configPath, "utf-8");
            if (currentConfig !== configSnapshot) {
              // Restore the original config — agents must not modify it
              writeFileSync(configPath, configSnapshot, "utf-8");
              // Add a warning to the last result so it surfaces in reports
              const lastResult = results[results.length - 1];
              if (lastResult) {
                lastResult.gates.push({
                  gate: "config-guard",
                  passed: true,
                  errors: [],
                  warnings: [
                    ".forge.json was modified by a fix agent and has been restored. Agents must not modify project configuration to pass verification.",
                  ],
                  duration_ms: 0,
                });
              }
            }
          } catch {
            // Non-fatal: if we can't read the file, skip detection
          }
        }
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

// ---------------------------------------------------------------------------
// Team Review Integration
// ---------------------------------------------------------------------------

interface TeamReviewOutcome {
  teamReviewResult: TeamReviewResult;
  hasAcceptedErrors: boolean;
  acceptedFindings: Finding[];
}

/**
 * Run the team-based review after mechanical gates pass.
 *
 * 1. Call reviewWaveDiff() to get findings from the reviewer
 * 2. If findings exist, call onBuilderResponses() to get builder consensus
 * 3. Run runConsensusProtocol() with the builder responses
 * 4. If escalations are needed, call onEscalation()
 * 5. Return the review outcome with accepted findings that need fixing
 */
async function runTeamReview(
  reviewerConfig: ReviewerConfig,
  onFixAttempt: VerifyLoopOptions["onFixAttempt"],
  onReviewComplete: VerifyLoopOptions["onReviewComplete"],
  iteration: number,
): Promise<TeamReviewOutcome> {
  const startTime = Date.now();

  // Step 1: Get findings from the reviewer
  const findings = reviewWaveDiff({
    projectDir: reviewerConfig.projectDir,
    prdPath: reviewerConfig.prdPath,
    baseBranch: reviewerConfig.baseBranch,
  });

  // No findings — review is clean
  if (findings.length === 0) {
    const emptyResult: TeamReviewResult = {
      findings: [],
      consensusResults: [],
      duration_ms: Date.now() - startTime,
    };
    onReviewComplete?.(emptyResult);
    return {
      teamReviewResult: emptyResult,
      hasAcceptedErrors: false,
      acceptedFindings: [],
    };
  }

  // Step 2: Get builder responses via SendMessage callback
  let responses = new Map<string, BuilderResponse[]>();
  if (reviewerConfig.onBuilderResponses) {
    responses = await reviewerConfig.onBuilderResponses(findings);
  }

  // Step 3: Run consensus protocol
  const consensusOutcome = runConsensusProtocol(findings, responses);
  let allConsensusResults = [...consensusOutcome.results];

  // Step 4: Handle escalations if needed
  if (consensusOutcome.needsEscalation.length > 0 && reviewerConfig.onEscalation) {
    const escalationDecisions = await reviewerConfig.onEscalation(
      consensusOutcome.needsEscalation,
    );

    // Apply escalation decisions to each finding that needed it
    for (let i = 0; i < consensusOutcome.needsEscalation.length; i++) {
      const finding = consensusOutcome.needsEscalation[i];
      const decision = escalationDecisions[i];
      if (finding && decision) {
        let state = createConsensusState(finding);
        // Replay builder responses to get to the escalation state
        const findingResponses = responses.get(finding.id) ?? [];
        for (const resp of findingResponses) {
          state = recordBuilderResponse(state, resp);
          if (state.resolved) break;
        }
        // Apply the executive decision
        state = escalateToExecutive(state, decision);
        if (state.result) {
          allConsensusResults.push(state.result);
        }
      }
    }
  }

  // Step 5: Collect accepted findings that need fixing
  const acceptedFindingIds = new Set(
    allConsensusResults
      .filter((r) => r.resolution === "accepted")
      .map((r) => r.findingId),
  );

  const acceptedFindings = findings.filter(
    (f) => acceptedFindingIds.has(f.id) && f.severity === "error",
  );

  const teamReviewResult: TeamReviewResult = {
    findings,
    consensusResults: allConsensusResults,
    duration_ms: Date.now() - startTime,
  };

  onReviewComplete?.(teamReviewResult);

  return {
    teamReviewResult,
    hasAcceptedErrors: acceptedFindings.length > 0,
    acceptedFindings,
  };
}

/** Convert review Findings into GateError[] for the fix callback */
function findingsToGateErrors(findings: Finding[]): GateError[] {
  return findings.map((f) => ({
    file: f.file,
    line: f.line,
    message: `[Review] ${f.message}`,
    remediation: f.remediation,
  }));
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
