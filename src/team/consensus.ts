import type { Finding, ConsensusRound, ConsensusResult } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsensusState {
  finding: Finding;
  rounds: ConsensusRound[];
  maxRounds: number;
  resolved: boolean;
  result: ConsensusResult | null;
}

export interface BuilderResponse {
  builderName: string;
  response: "agree" | "disagree" | "alternative";
  reason?: string;
  alternativeProposal?: string;
}

export interface EscalationDecision {
  decision: string;
  accepted: boolean;
}

// ---------------------------------------------------------------------------
// createConsensusState — initializes tracking state for a single finding
// ---------------------------------------------------------------------------
export function createConsensusState(
  finding: Finding,
  maxRounds: number = 2,
): ConsensusState {
  return {
    finding,
    rounds: [],
    maxRounds,
    resolved: false,
    result: null,
  };
}

// ---------------------------------------------------------------------------
// recordBuilderResponse — records a builder's response and advances state
// ---------------------------------------------------------------------------
export function recordBuilderResponse(
  state: ConsensusState,
  response: BuilderResponse,
): ConsensusState {
  const round = state.rounds.length + 1;

  const consensusRound: ConsensusRound = {
    findingId: state.finding.id,
    round,
    builderName: response.builderName,
    response: response.response,
    reason: response.reason,
    alternativeProposal: response.alternativeProposal,
  };

  const newRounds = [...state.rounds, consensusRound];

  // Builder agrees — resolve immediately as accepted
  if (response.response === "agree") {
    return {
      ...state,
      rounds: newRounds,
      resolved: true,
      result: {
        findingId: state.finding.id,
        resolution: "accepted",
        rounds: newRounds,
      },
    };
  }

  // Builder disagrees or proposes alternative
  // If we haven't exhausted rounds, leave unresolved for next round
  // If rounds exhausted, still leave unresolved — escalateToExecutive will resolve
  return {
    ...state,
    rounds: newRounds,
    resolved: false,
    result: null,
  };
}

// ---------------------------------------------------------------------------
// needsEscalation — true when rounds are exhausted without agreement
// ---------------------------------------------------------------------------
export function needsEscalation(state: ConsensusState): boolean {
  if (state.resolved) return false;
  if (state.rounds.length < state.maxRounds) return false;

  const lastRound = state.rounds[state.rounds.length - 1];
  if (!lastRound) return false;

  return lastRound.response === "disagree" || lastRound.response === "alternative";
}

// ---------------------------------------------------------------------------
// escalateToExecutive — resolves a deadlocked finding via executive decision
// ---------------------------------------------------------------------------
export function escalateToExecutive(
  state: ConsensusState,
  decision: EscalationDecision,
): ConsensusState {
  const resolution = decision.accepted ? "accepted" : "rejected";

  return {
    ...state,
    resolved: true,
    result: {
      findingId: state.finding.id,
      resolution,
      rounds: [...state.rounds],
      finalDecision: decision.decision,
    },
  };
}

// ---------------------------------------------------------------------------
// runConsensusProtocol — batch-processes multiple findings with responses
// ---------------------------------------------------------------------------
export function runConsensusProtocol(
  findings: Finding[],
  responses: Map<string, BuilderResponse[]>,
): { results: ConsensusResult[]; needsEscalation: Finding[] } {
  const results: ConsensusResult[] = [];
  const escalationList: Finding[] = [];

  for (const finding of findings) {
    let state = createConsensusState(finding);
    const findingResponses = responses.get(finding.id) ?? [];

    for (const response of findingResponses) {
      state = recordBuilderResponse(state, response);
      if (state.resolved) break;
    }

    if (state.resolved && state.result) {
      results.push(state.result);
    } else if (needsEscalation(state)) {
      escalationList.push(finding);
    }
  }

  return { results, needsEscalation: escalationList };
}

// ---------------------------------------------------------------------------
// formatFindingForReview — human-readable finding string for messages
// ---------------------------------------------------------------------------
export function formatFindingForReview(finding: Finding): string {
  const location =
    finding.file != null
      ? `${finding.file}${finding.line != null ? `:${finding.line}` : ""}`
      : undefined;

  const locationLine = location ? `${location} — ${finding.source}` : finding.source;

  return [
    `**[${finding.severity}]** ${finding.message}`,
    locationLine,
    `> Remediation: ${finding.remediation}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// formatConsensusResult — human-readable consensus outcome
// ---------------------------------------------------------------------------
export function formatConsensusResult(
  result: ConsensusResult,
  finding: Finding,
): string {
  const lines = [
    `Finding: ${finding.message}`,
    `Resolution: ${result.resolution}`,
    `Rounds: ${result.rounds.length}`,
  ];

  if (result.finalDecision) {
    lines.push(`Executive decision: ${result.finalDecision}`);
  }

  return lines.join("\n");
}
