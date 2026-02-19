import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { readMilestoneSection, buildPrompt } from "../../src/runner/prompt.js";
import type { PipelineResult } from "../../src/types.js";

function tempDir() {
  return join(tmpdir(), `forge-test-${randomUUID()}`);
}

const samplePRD = `# My Project PRD

## Overview
This is a sample project.

### Milestone 1: Foundation
Set up the project structure.
- Create directories
- Initialize configs

### Milestone 2: Core Features
Build the core feature set.
- Implement API
- Add validation

### Milestone 3: Polish
Final polish and docs.
- Write documentation
- Clean up code
`;

describe("prompt builder", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  describe("readMilestoneSection", () => {
    it("extracts the correct milestone section from a PRD", async () => {
      const dir = tempDir();
      dirs.push(dir);
      await mkdir(dir, { recursive: true });
      const prdPath = join(dir, "prd.md");
      await writeFile(prdPath, samplePRD, "utf-8");

      const section = await readMilestoneSection(prdPath, 2);
      expect(section).toContain("### Milestone 2: Core Features");
      expect(section).toContain("Build the core feature set.");
      expect(section).toContain("Implement API");
      expect(section).toContain("Add validation");
      // Should NOT contain other milestones
      expect(section).not.toContain("### Milestone 1");
      expect(section).not.toContain("### Milestone 3");
    });

    it("extracts the last milestone (no next header)", async () => {
      const dir = tempDir();
      dirs.push(dir);
      await mkdir(dir, { recursive: true });
      const prdPath = join(dir, "prd.md");
      await writeFile(prdPath, samplePRD, "utf-8");

      const section = await readMilestoneSection(prdPath, 3);
      expect(section).toContain("### Milestone 3: Polish");
      expect(section).toContain("Clean up code");
      expect(section).not.toContain("### Milestone 2");
    });

    it("throws when milestone does not exist", async () => {
      const dir = tempDir();
      dirs.push(dir);
      await mkdir(dir, { recursive: true });
      const prdPath = join(dir, "prd.md");
      await writeFile(prdPath, samplePRD, "utf-8");

      await expect(readMilestoneSection(prdPath, 99)).rejects.toThrow(
        "Milestone 99 not found",
      );
    });
  });

  describe("buildPrompt", () => {
    it("includes PRD milestone section and error context", () => {
      const verifyErrors: PipelineResult = {
        result: "FAILED",
        durationMs: 1200,
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
                message: "Type 'string' is not assignable to type 'number'",
                rule: "TS2322",
              },
            ],
          },
          {
            gate: "lint",
            passed: true,
            durationMs: 400,
            errors: [],
          },
        ],
      };

      const prompt = buildPrompt({
        milestoneName: "Core Features",
        milestoneNumber: 2,
        milestoneSection:
          "### Milestone 2: Core Features\nBuild the core feature set.",
        verifyErrors,
      });

      // Includes milestone header
      expect(prompt).toContain("# Task: Complete Milestone 2 — Core Features");
      // Includes PRD milestone section
      expect(prompt).toContain(
        "### Milestone 2: Core Features\nBuild the core feature set.",
      );
      // Includes error context
      expect(prompt).toContain("forge verify: FAILED");
      expect(prompt).toContain('Gate "types" FAILED');
      expect(prompt).toContain("src/foo.ts:10:5");
      expect(prompt).toContain(
        "Type 'string' is not assignable to type 'number'",
      );
      expect(prompt).toContain("[TS2322]");
      // Includes rules
      expect(prompt).toContain("npx forge verify");
      expect(prompt).toContain("Commit your work before exiting");
    });

    it("uses first-iteration message when no errors provided", () => {
      const prompt = buildPrompt({
        milestoneName: "Foundation",
        milestoneNumber: 1,
        milestoneSection: "### Milestone 1: Foundation\nSet up the project.",
      });

      expect(prompt).toContain("First iteration — start from scratch");
      expect(prompt).not.toContain("FAILED");
    });

    it("uses first-iteration message when verifyErrors is null", () => {
      const prompt = buildPrompt({
        milestoneName: "Foundation",
        milestoneNumber: 1,
        milestoneSection: "### Milestone 1: Foundation\nSet up the project.",
        verifyErrors: null,
      });

      expect(prompt).toContain("First iteration — start from scratch");
    });

    it("uses first-iteration message when verify passed", () => {
      const passed: PipelineResult = {
        result: "PASSED",
        durationMs: 500,
        gates: [
          { gate: "types", passed: true, durationMs: 500, errors: [] },
        ],
      };

      const prompt = buildPrompt({
        milestoneName: "Foundation",
        milestoneNumber: 1,
        milestoneSection: "### Milestone 1: Foundation\nSet up the project.",
        verifyErrors: passed,
      });

      expect(prompt).toContain("First iteration — start from scratch");
    });

    it("formats errors without column number", () => {
      const errors: PipelineResult = {
        result: "FAILED",
        durationMs: 300,
        gates: [
          {
            gate: "lint",
            passed: false,
            durationMs: 300,
            errors: [
              {
                file: "src/bar.ts",
                line: 42,
                message: "Unexpected any",
              },
            ],
          },
        ],
      };

      const prompt = buildPrompt({
        milestoneName: "Polish",
        milestoneNumber: 3,
        milestoneSection: "### Milestone 3: Polish\nClean up.",
        verifyErrors: errors,
      });

      // Should use file:line format (no column)
      expect(prompt).toContain("src/bar.ts:42");
      expect(prompt).not.toContain("src/bar.ts:42:");
    });
  });
});
