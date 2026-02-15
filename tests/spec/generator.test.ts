import { describe, it, expect } from "vitest";
import { validatePRD, createEmptyPRD } from "../../src/spec/templates.js";
import type { PRDData } from "../../src/spec/templates.js";
import { generatePRD, generateDraftPRD } from "../../src/spec/generator.js";

const mockPRD: PRDData = {
  project: "test-project",
  status: "Ready for execution",
  branch: "feat/test",
  created: "2026-02-15",
  assignedTo: "Troy",
  linearProject: "Test Project",
  overview: "A test project overview.",
  problemStatement: "Test problem.",
  scope: { inScope: ["Feature A"], outOfScope: ["Feature B"], sacred: ["config.ts"] },
  userStories: [{
    id: "1",
    title: "User Login",
    description: "As a user, I want to log in",
    acceptanceCriteria: ["Login form works", "Auth token stored"],
  }],
  technicalDesign: { dependencies: ["react", "next"] },
  milestones: [{
    number: 1,
    name: "Foundation",
    goal: "Set up the project",
    assignedTo: "Troy",
    waves: [{ waveNumber: 1, agents: [{ name: "setup", task: "Init project", files: ["package.json"] }] }],
    verificationCommands: ["npm test"],
  }],
  verification: { perMilestone: ["M1: tests pass"], overall: ["All tests pass"] },
};

describe("validatePRD", () => {
  it("validates correct data", () => {
    const result = validatePRD(mockPRD);
    expect(result.project).toBe("test-project");
    expect(result.userStories).toHaveLength(1);
  });

  it("throws on invalid data", () => {
    expect(() => validatePRD({})).toThrow();
    expect(() => validatePRD({ project: 123 })).toThrow();
    expect(() => validatePRD({ ...mockPRD, milestones: "bad" })).toThrow();
  });
});

describe("createEmptyPRD", () => {
  it("returns valid scaffold with project name", () => {
    const empty = createEmptyPRD("my-project");

    expect(empty.project).toBe("my-project");
    expect(empty.status).toBe("Draft");
    expect(empty.userStories).toEqual([]);
    expect(empty.milestones).toEqual([]);
    expect(empty.scope.inScope).toEqual([]);
    // Should pass validation
    const validated = validatePRD(empty);
    expect(validated.project).toBe("my-project");
  });
});

describe("generatePRD", () => {
  it("produces correct markdown structure with expected headers", () => {
    const md = generatePRD(mockPRD);

    expect(md).toContain("# test-project — Specification");
    expect(md).toContain("**Project:** test-project");
    expect(md).toContain("**Status:** Ready for execution");
    expect(md).toContain("**Linear Project:** Test Project");
    expect(md).toContain("## Overview");
    expect(md).toContain("A test project overview.");
    expect(md).toContain("## Problem Statement");
    expect(md).toContain("## Scope");
    expect(md).toContain("### In Scope");
    expect(md).toContain("- Feature A");
    expect(md).toContain("### Out of Scope");
    expect(md).toContain("### Sacred / Do NOT Touch");
    expect(md).toContain("## User Stories");
    expect(md).toContain("### US-1: User Login");
    expect(md).toContain("- [ ] Login form works");
    expect(md).toContain("## Technical Design");
    expect(md).toContain("- react");
    expect(md).toContain("## Implementation Milestones");
    expect(md).toContain("### Milestone 1: Foundation");
    expect(md).toContain("**Wave 1 (1 agent parallel):**");
    expect(md).toContain("## Verification");
    expect(md).toContain("- M1: tests pass");
  });
});

describe("generateDraftPRD", () => {
  it("handles partial data with defaults", () => {
    const md = generateDraftPRD({ project: "draft-test", overview: "Some overview" });

    expect(md).toContain("# draft-test — Specification");
    expect(md).toContain("**Status:** Draft");
    expect(md).toContain("**Branch:** TBD");
    expect(md).toContain("## Overview");
    expect(md).toContain("Some overview");
    // Should not contain sections that were not provided
    expect(md).not.toContain("## Problem Statement");
    expect(md).not.toContain("## User Stories");
  });

  it("uses sensible defaults for missing project name", () => {
    const md = generateDraftPRD({});

    expect(md).toContain("# Untitled Project — Specification");
    expect(md).toContain("**Assigned To:** TBD");
  });
});
