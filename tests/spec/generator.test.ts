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

describe("generatePRD — testCriteria and test gate auto-inclusion", () => {
  it("auto-includes 'npx forge verify --gate tests' in verification commands", () => {
    const md = generatePRD(mockPRD);

    // The mockPRD has verificationCommands: ["npm test"] but NOT the test gate
    expect(md).toContain("npx forge verify --gate tests");
  });

  it("does not duplicate the test gate command if already present", () => {
    const prdWithTestGate: PRDData = {
      ...mockPRD,
      milestones: [{
        ...mockPRD.milestones[0],
        verificationCommands: ["npm test", "npx forge verify --gate tests"],
      }],
    };

    const md = generatePRD(prdWithTestGate);

    // Count occurrences of the test gate command
    const matches = md.match(/npx forge verify --gate tests/g);
    expect(matches).toHaveLength(1);
  });

  it("renders 'Test Requirements' section with default testCriteria", () => {
    // When testCriteria is not specified, the Zod schema provides defaults
    const validatedPRD = validatePRD(mockPRD);
    const md = generatePRD(validatedPRD);

    expect(md).toContain("**Test Requirements:**");
    expect(md).toContain("- All new source files must have corresponding test files");
    expect(md).toContain("- Run `npx forge verify --gate tests` to validate test coverage");
  });

  it("renders custom testCriteria correctly", () => {
    const prdWithCustomCriteria: PRDData = {
      ...mockPRD,
      milestones: [{
        ...mockPRD.milestones[0],
        testCriteria: [
          "Unit tests for all API endpoints",
          "Integration tests for auth flow",
        ],
      }],
    };

    const md = generatePRD(prdWithCustomCriteria);

    expect(md).toContain("**Test Requirements:**");
    expect(md).toContain("- Unit tests for all API endpoints");
    expect(md).toContain("- Integration tests for auth flow");
  });

  it("omits 'Test Requirements' section when testCriteria is empty", () => {
    const prdWithEmptyCriteria: PRDData = {
      ...mockPRD,
      milestones: [{
        ...mockPRD.milestones[0],
        testCriteria: [],
      }],
    };

    const md = generatePRD(prdWithEmptyCriteria);

    expect(md).not.toContain("**Test Requirements:**");
  });
});

describe("validatePRD — testCriteria defaults", () => {
  it("accepts milestone without explicit testCriteria and applies defaults", () => {
    // mockPRD does not include testCriteria on its milestone
    const result = validatePRD(mockPRD);

    expect(result.milestones[0].testCriteria).toEqual([
      "All new source files must have corresponding test files",
      "Run `npx forge verify --gate tests` to validate test coverage",
    ]);
  });

  it("accepts milestone with explicit empty testCriteria", () => {
    const prdWithEmpty = {
      ...mockPRD,
      milestones: [{
        ...mockPRD.milestones[0],
        testCriteria: [],
      }],
    };

    const result = validatePRD(prdWithEmpty);
    expect(result.milestones[0].testCriteria).toEqual([]);
  });

  it("accepts milestone with custom testCriteria", () => {
    const prdWithCustom = {
      ...mockPRD,
      milestones: [{
        ...mockPRD.milestones[0],
        testCriteria: ["Custom criterion"],
      }],
    };

    const result = validatePRD(prdWithCustom);
    expect(result.milestones[0].testCriteria).toEqual(["Custom criterion"]);
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
