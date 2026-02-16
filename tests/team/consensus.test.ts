import { describe, it, expect } from "vitest";
import {
  createConsensusState,
  recordBuilderResponse,
  needsEscalation,
  escalateToExecutive,
  runConsensusProtocol,
  formatFindingForReview,
  formatConsensusResult,
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

  it("accepts custom maxRounds", () => {
    const state = createConsensusState(makeFinding(), 5);
    expect(state.maxRounds).toBe(5);
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
    expect(next.result).not.toBeNull();
    expect(next.result!.resolution).toBe("accepted");
    expect(next.result!.findingId).toBe("f-001");
    expect(next.rounds).toHaveLength(1);
    expect(next.rounds[0].response).toBe("agree");
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
    expect(next.rounds).toHaveLength(1);
  });

  it("does NOT resolve when builder proposes alternative", () => {
    const state = createConsensusState(makeFinding());
    const next = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "alternative",
      alternativeProposal: "Use optional chaining instead",
    });

    expect(next.resolved).toBe(false);
    expect(next.result).toBeNull();
    expect(next.rounds).toHaveLength(1);
  });

  it("does not mutate the original state (immutability)", () => {
    const state = createConsensusState(makeFinding());
    const originalRoundsLength = state.rounds.length;

    recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "agree",
    });

    // Original state should be unchanged
    expect(state.rounds.length).toBe(originalRoundsLength);
    expect(state.resolved).toBe(false);
    expect(state.result).toBeNull();
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

  it("returns false when rounds < maxRounds", () => {
    const state = createConsensusState(makeFinding(), 3);
    const next = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "disagree",
    });

    // 1 round < maxRounds(3) -> no escalation yet
    expect(needsEscalation(next)).toBe(false);
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

    expect(current.rounds).toHaveLength(2);
    expect(needsEscalation(current)).toBe(true);
  });

  it("returns true when rounds >= maxRounds and last response is alternative", () => {
    const state = createConsensusState(makeFinding(), 2);
    let current = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "disagree",
    });
    current = recordBuilderResponse(current, {
      builderName: "builder-1",
      response: "alternative",
      alternativeProposal: "Different approach",
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
    expect(escalated.result).not.toBeNull();
    expect(escalated.result!.resolution).toBe("accepted");
    expect(escalated.result!.finalDecision).toBe(
      "The finding is valid, apply the fix",
    );
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
    expect(escalated.result).not.toBeNull();
    expect(escalated.result!.resolution).toBe("rejected");
    expect(escalated.result!.finalDecision).toBe(
      "Builder is right, skip this finding",
    );
  });
});

// ---------------------------------------------------------------------------
// runConsensusProtocol
// ---------------------------------------------------------------------------

describe("runConsensusProtocol", () => {
  it("processes multiple findings and returns resolved results and escalation list", () => {
    const finding1 = makeFinding({ id: "f-100", message: "Issue A" });
    const finding2 = makeFinding({ id: "f-200", message: "Issue B" });
    const finding3 = makeFinding({ id: "f-300", message: "Issue C" });

    const responses = new Map<
      string,
      Array<{
        builderName: string;
        response: "agree" | "disagree" | "alternative";
        reason?: string;
      }>
    >();

    // finding1: builder agrees -> resolved as accepted
    responses.set("f-100", [
      { builderName: "builder-1", response: "agree" },
    ]);

    // finding2: builder disagrees twice -> needs escalation
    responses.set("f-200", [
      { builderName: "builder-1", response: "disagree", reason: "No" },
      { builderName: "builder-1", response: "disagree", reason: "Still no" },
    ]);

    // finding3: no responses -> unresolved but not enough rounds to escalate
    responses.set("f-300", []);

    const { results, needsEscalation: escalations } = runConsensusProtocol(
      [finding1, finding2, finding3],
      responses,
    );

    // finding1 should be in results as accepted
    expect(results).toHaveLength(1);
    expect(results[0].findingId).toBe("f-100");
    expect(results[0].resolution).toBe("accepted");

    // finding2 should need escalation
    expect(escalations).toHaveLength(1);
    expect(escalations[0].id).toBe("f-200");
  });
});

// ---------------------------------------------------------------------------
// formatFindingForReview
// ---------------------------------------------------------------------------

describe("formatFindingForReview", () => {
  it("includes severity, message, source, and remediation", () => {
    const finding = makeFinding({
      severity: "warning",
      message: "Unused variable",
      source: "linter",
      remediation: "Remove unused variable",
    });

    const formatted = formatFindingForReview(finding);

    expect(formatted).toContain("warning");
    expect(formatted).toContain("Unused variable");
    expect(formatted).toContain("linter");
    expect(formatted).toContain("Remove unused variable");
  });

  it("includes file and line when present", () => {
    const finding = makeFinding({
      file: "src/foo.ts",
      line: 42,
      source: "checker",
    });

    const formatted = formatFindingForReview(finding);

    expect(formatted).toContain("src/foo.ts");
    expect(formatted).toContain("42");
  });

  it("omits file location when not present", () => {
    const finding = makeFinding({
      file: undefined,
      line: undefined,
      source: "global-check",
    });

    const formatted = formatFindingForReview(finding);

    expect(formatted).toContain("global-check");
    expect(formatted).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// formatConsensusResult
// ---------------------------------------------------------------------------

describe("formatConsensusResult", () => {
  it("includes resolution and round count", () => {
    const finding = makeFinding({ message: "Test issue" });
    const state = createConsensusState(finding);
    const resolved = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "agree",
    });

    const formatted = formatConsensusResult(resolved.result!, finding);

    expect(formatted).toContain("accepted");
    expect(formatted).toContain("Test issue");
    expect(formatted).toContain("1"); // 1 round
  });

  it("includes executive decision when present", () => {
    const finding = makeFinding({ message: "Critical bug" });
    const state = createConsensusState(finding);
    const disagreed = recordBuilderResponse(state, {
      builderName: "builder-1",
      response: "disagree",
    });
    const escalated = escalateToExecutive(disagreed, {
      decision: "Override: apply the fix",
      accepted: true,
    });

    const formatted = formatConsensusResult(escalated.result!, finding);

    expect(formatted).toContain("accepted");
    expect(formatted).toContain("Override: apply the fix");
  });
});
