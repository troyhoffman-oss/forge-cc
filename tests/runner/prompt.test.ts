import { describe, it, expect } from "vitest";
import { buildRequirementPrompt } from "../../src/runner/prompt.js";
import type { PipelineResult } from "../../src/types.js";
import type { Requirement } from "../../src/graph/types.js";

describe("prompt builder", () => {
  describe("buildRequirementPrompt", () => {
    function makeRequirement(
      overrides?: Partial<Requirement>,
    ): Requirement {
      return {
        id: "req-001",
        title: "Test Requirement",
        files: { creates: ["src/new.ts"], modifies: ["src/existing.ts"] },
        acceptance: ["It compiles", "It passes tests"],
        body: "## Context\nBuild the thing.\n\n## Technical Approach\nUse TypeScript.",
        ...overrides,
      };
    }

    it("includes overview, requirement body, acceptance criteria, and file scope", () => {
      const req = makeRequirement();
      const prompt = buildRequirementPrompt({
        requirement: req,
        overview: "A sample project overview.",
        depContext: [],
      });

      expect(prompt).toContain(
        "# Task: Complete Requirement req-001 — Test Requirement",
      );
      expect(prompt).toContain("## Project Overview\nA sample project overview.");
      expect(prompt).toContain("## Your Requirement\n" + req.body);
      expect(prompt).toContain("- It compiles");
      expect(prompt).toContain("- It passes tests");
      expect(prompt).toContain("**Creates:** src/new.ts");
      expect(prompt).toContain("**Modifies:** src/existing.ts");
    });

    it("includes dependency context when deps are provided", () => {
      const req = makeRequirement();
      const dep: Requirement = {
        id: "req-000",
        title: "Dependency Req",
        files: { creates: [], modifies: [] },
        acceptance: ["Dep accepted"],
        body: "Dep body content.",
      };

      const prompt = buildRequirementPrompt({
        requirement: req,
        overview: "Overview text.",
        depContext: [dep],
      });

      expect(prompt).toContain("## Completed Dependencies");
      expect(prompt).toContain("### req-000: Dependency Req");
      expect(prompt).toContain("Dep body content.");
    });

    it("omits dependency section when depContext is empty", () => {
      const req = makeRequirement();
      const prompt = buildRequirementPrompt({
        requirement: req,
        overview: "Overview text.",
        depContext: [],
      });

      expect(prompt).not.toContain("## Completed Dependencies");
    });

    it("formats verify errors correctly", () => {
      const req = makeRequirement();
      const verifyErrors: PipelineResult = {
        result: "FAILED",
        durationMs: 1000,
        gates: [
          {
            gate: "types",
            passed: false,
            durationMs: 800,
            errors: [
              {
                file: "src/foo.ts",
                line: 10,
                column: 5,
                message: "Type error found",
                rule: "TS2322",
              },
            ],
          },
        ],
      };

      const prompt = buildRequirementPrompt({
        requirement: req,
        overview: "Overview.",
        depContext: [],
        verifyErrors,
      });

      expect(prompt).toContain("forge verify: FAILED");
      expect(prompt).toContain('Gate "types" FAILED');
      expect(prompt).toContain("src/foo.ts:10:5");
      expect(prompt).toContain("Type error found");
      expect(prompt).toContain("[TS2322]");
    });

    it('uses "First iteration" when no errors provided', () => {
      const req = makeRequirement();
      const prompt = buildRequirementPrompt({
        requirement: req,
        overview: "Overview.",
        depContext: [],
      });

      expect(prompt).toContain("First iteration — start from scratch");
      expect(prompt).not.toContain("FAILED");
    });
  });
});
