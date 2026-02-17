import { describe, it, expect } from "vitest";
import type { GateError, PipelineResult } from "../../src/types.js";
import {
  buildTypeRemediation,
  buildLintRemediation,
  buildTestRemediation,
  buildVisualRemediation,
  buildReviewRemediation,
  buildTestCoverageRemediation,
} from "../../src/gates/remediation.js";
import { formatErrorsForAgent } from "../../src/go/verify-loop.js";

// ---------------------------------------------------------------------------
// Part 1: Remediation builders (pure function tests, no mocking needed)
// ---------------------------------------------------------------------------

describe("buildTypeRemediation", () => {
  it("returns remediation containing 'assignable' or 'type' for TS2322", () => {
    const error: GateError = {
      file: "src/foo.ts",
      line: 10,
      message: "error TS2322: Type 'string' is not assignable to type 'number'.",
    };
    const result = buildTypeRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/assignable|type/i);
  });

  it("returns remediation containing 'name' or 'import' for TS2304", () => {
    const error: GateError = {
      file: "src/bar.ts",
      line: 42,
      message: "error TS2304: Cannot find name 'baz'.",
    };
    const result = buildTypeRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/name|import/i);
  });

  it("returns non-empty string for unknown TS code (TS9999)", () => {
    const error: GateError = {
      message: "error TS9999: Some unknown error.",
    };
    const result = buildTypeRemediation(error);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("TS9999");
  });

  it("includes file location when file and line are provided", () => {
    const error: GateError = {
      file: "src/index.ts",
      line: 5,
      message: "error TS2322: Type mismatch.",
    };
    const result = buildTypeRemediation(error);
    expect(result).toContain("src/index.ts:5");
  });
});

describe("buildLintRemediation", () => {
  it("returns remediation containing 'const' for lint/style/useConst", () => {
    const error: GateError = {
      file: "src/utils.ts",
      line: 22,
      message: "error lint/style/useConst",
    };
    const result = buildLintRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/const/i);
  });

  it("returns remediation containing 'unused' for no-unused-vars", () => {
    const error: GateError = {
      file: "src/app.ts",
      line: 3,
      message: "error no-unused-vars: 'x' is defined but never used",
    };
    const result = buildLintRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/unused/i);
  });

  it("returns non-empty string for unknown lint rule", () => {
    const error: GateError = {
      message: "some-completely-unknown-lint-issue occurred",
    };
    const result = buildLintRemediation(error);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildTestRemediation", () => {
  it("returns remediation containing 'assertion' or 'expected' for assertion mismatch", () => {
    const error: GateError = {
      file: "src/foo.test.ts",
      line: 42,
      message: "Expected: 1 Received: 2",
    };
    const result = buildTestRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/assertion|expected/i);
  });

  it("returns remediation containing 'timeout' for timeout errors", () => {
    const error: GateError = {
      message: "Test timed out after 5000ms",
    };
    const result = buildTestRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/timeout/i);
  });
});

describe("buildVisualRemediation", () => {
  it("returns string containing 'overflow' for overflow errors", () => {
    const error: GateError = {
      message: "Element has overflow on mobile viewport",
    };
    const result = buildVisualRemediation(error);
    expect(result).toMatch(/overflow/i);
  });

  it("returns string containing 'missing' for missing element errors", () => {
    const error: GateError = {
      message: "missing element: #nav-bar not found in DOM",
    };
    const result = buildVisualRemediation(error);
    expect(result).toMatch(/missing/i);
  });

  it("returns non-empty fallback for error with no matching pattern", () => {
    const error: GateError = {
      message: "something weird happened during visual check",
    };
    const result = buildVisualRemediation(error);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("buildReviewRemediation", () => {
  it("returns string containing 'PRD' for PRD section references", () => {
    const error: GateError = {
      message: 'PRD section "User Authentication" criterion not addressed',
    };
    const result = buildReviewRemediation(error);
    expect(result).toMatch(/PRD/);
  });

  it("returns string containing 'CLAUDE.md' for CLAUDE.md rule references", () => {
    const error: GateError = {
      message: "CLAUDE.md: [agent staging] rule violation in deployment script",
    };
    const result = buildReviewRemediation(error);
    expect(result).toMatch(/CLAUDE\.md/);
  });

  it("includes existing remediation text when present", () => {
    const error: GateError = {
      message: "Some review finding",
      remediation: "Existing fix suggestion",
    };
    const result = buildReviewRemediation(error);
    expect(result).toContain("Existing fix suggestion");
  });
});

describe("buildTestCoverageRemediation", () => {
  it("returns enforcement remediation for missing test file with file context", () => {
    const error: GateError = {
      file: "src/new-feature.ts",
      message: "Missing test file for changed source: src/new-feature.ts",
    };
    const result = buildTestCoverageRemediation(error);
    expect(result).toContain("src/new-feature.ts");
    expect(result).toMatch(/create a test file/i);
  });

  it("returns baseline remediation for 'no tests found' message", () => {
    const error: GateError = {
      message: "No tests found. 5 source files across 2 categories have no test coverage.",
    };
    const result = buildTestCoverageRemediation(error);
    expect(result).toMatch(/no tests exist/i);
  });

  it("returns thin coverage remediation for 'thin coverage' message", () => {
    const error: GateError = {
      message: "Thin coverage: ratio 0.1 (1 test file for 10 source files)",
    };
    const result = buildTestCoverageRemediation(error);
    expect(result).toMatch(/coverage is very low/i);
  });
});

// ---------------------------------------------------------------------------
// Part 2: formatErrorsForAgent renders remediation
// ---------------------------------------------------------------------------

describe("formatErrorsForAgent", () => {
  it("includes '> **Remediation:**' in output for errors with remediation", () => {
    const result: PipelineResult = {
      passed: false,
      iteration: 1,
      maxIterations: 3,
      gates: [
        {
          gate: "types",
          passed: false,
          errors: [
            {
              file: "src/foo.ts",
              line: 10,
              message: "error TS2322: Type 'string' is not assignable to type 'number'.",
              remediation: "TS2322: Type is not assignable — change the target type.",
            },
          ],
          warnings: [],
          duration_ms: 100,
        },
      ],
      report: "",
    };

    const output = formatErrorsForAgent(result);

    expect(output).toContain("> **Remediation:**");
    expect(output).toContain("TS2322");
  });

  it("renders multiple gate errors each with remediation", () => {
    const result: PipelineResult = {
      passed: false,
      iteration: 1,
      maxIterations: 3,
      gates: [
        {
          gate: "types",
          passed: false,
          errors: [
            {
              file: "src/a.ts",
              line: 1,
              message: "error TS2304: Cannot find name 'x'.",
              remediation: "Check for missing import.",
            },
          ],
          warnings: [],
          duration_ms: 50,
        },
        {
          gate: "lint",
          passed: false,
          errors: [
            {
              file: "src/b.ts",
              line: 5,
              message: "error lint/style/useConst",
              remediation: "Change let to const.",
            },
          ],
          warnings: [],
          duration_ms: 30,
        },
      ],
      report: "",
    };

    const output = formatErrorsForAgent(result);

    const remediationCount = (output.match(/> \*\*Remediation:\*\*/g) || []).length;
    expect(remediationCount).toBe(2);
  });

  it("omits remediation block when remediation field is absent", () => {
    const result: PipelineResult = {
      passed: false,
      iteration: 1,
      maxIterations: 3,
      gates: [
        {
          gate: "types",
          passed: false,
          errors: [
            {
              file: "src/foo.ts",
              line: 10,
              message: "error TS2322: Something.",
            },
          ],
          warnings: [],
          duration_ms: 100,
        },
      ],
      report: "",
    };

    const output = formatErrorsForAgent(result);

    expect(output).not.toContain("> **Remediation:**");
  });

  it("returns 'All gates passed' when no gates failed", () => {
    const result: PipelineResult = {
      passed: true,
      iteration: 1,
      maxIterations: 3,
      gates: [
        {
          gate: "types",
          passed: true,
          errors: [],
          warnings: [],
          duration_ms: 100,
        },
      ],
      report: "",
    };

    const output = formatErrorsForAgent(result);
    expect(output).toContain("All gates passed");
  });
});
