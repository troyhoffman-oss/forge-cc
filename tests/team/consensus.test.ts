import { describe, it, expect } from "vitest";
import {
  createConsensusState,
  recordBuilderResponse,
  needsEscalation,
  escalateToExecutive,
} from "../../src/team/consensus.js";
import type { Finding } from "../../src/team/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides?: Partial<Finding>): Finding {
  return {
    id: "f-001",
    severity: "error",
    message: "Missing null check",
    remediation: "Add null guard before access",
    source: "reviewer",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createConsensusState
// ---------------------------------------------------------------------------

describe("createConsensusState", () => {
  it("initializes with empty rounds, resolved=false, result=null", () => {
    const finding = makeFinding();
    const state = createConsensusState(finding);

    expect(state.finding).toBe(finding);
    expect(state.rounds).toEqual([]);
    expect(state.resolved).toBe(false);
    expect(state.result).toBeNull();
  });

  it("defaults maxRounds to 2", () => {
    const state = createConsensusState(makeFinding());
    expect(state.maxRounds).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// recordBuilderResponse
// ---------------------------------------------------------------------------

describe("recordBuilderResponse", () => {
  it("resolves immediately as 'accepted' when builder agrees", () => {
    const state = createConsensusState(makeFinding());
    const next = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "agree",
      reason: "Looks correct",
    });

    expect(next.resolved).toBe(true);
    expect(next.result!.resolution).toBe("accepted");
    expect(next.rounds).toHaveLength(1);
  });

  it("does NOT resolve when builder disagrees", () => {
    const state = createConsensusState(makeFinding());
    const next = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "disagree",
      reason: "Not a real issue",
    });

    expect(next.resolved).toBe(false);
    expect(next.result).toBeNull();
  });

  it("does not mutate the original state (immutability)", () => {
    const state = createConsensusState(makeFinding());
    const originalRoundsLength = state.rounds.length;

    recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "agree",
    });

    expect(state.rounds.length).toBe(originalRoundsLength);
    expect(state.resolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// needsEscalation
// ---------------------------------------------------------------------------

describe("needsEscalation", () => {
  it("returns false when resolved", () => {
    const state = createConsensusState(makeFinding());
    const resolved = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "agree",
    });

    expect(needsEscalation(resolved)).toBe(false);
  });

  it("returns true when rounds >= maxRounds and last response is disagree", () => {
    const state = createConsensusState(makeFinding(), 2);
    let current = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "disagree",
      reason: "Nope",
    });
    current = recordBuilderResponse(current, {
      builderName: "builder-1",
      response: "disagree",
      reason: "Still nope",
    });

    expect(needsEscalation(current)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// escalateToExecutive
// ---------------------------------------------------------------------------

describe("escalateToExecutive", () => {
  it("resolves as 'accepted' when executive accepts", () => {
    const state = createConsensusState(makeFinding());
    const disagreed = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "disagree",
    });

    const escalated = escalateToExecutive(disagreed, {
      decision: "The finding is valid, apply the fix",
      accepted: true,
    });

    expect(escalated.resolved).toBe(true);
    expect(escalated.result!.resolution).toBe("accepted");
  });

  it("resolves as 'rejected' when executive rejects", () => {
    const state = createConsensusState(makeFinding());
    const disagreed = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "disagree",
    });

    const escalated = escalateToExecutive(disagreed, {
      decision: "Builder is right, skip this finding",
      accepted: false,
    });

    expect(escalated.resolved).toBe(true);
    expect(escalated.result!.resolution).toBe("rejected");
  });
});
