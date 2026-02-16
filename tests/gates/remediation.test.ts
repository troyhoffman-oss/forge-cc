import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GateError, GateResult, PipelineResult } from "../../src/types.js";
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
    // Should include the error code even for unknown codes
    expect(result).toContain("TS9999");
  });

  it("returns non-empty string for error without TS code", () => {
    const error: GateError = {
      message: "Something went terribly wrong",
    };
    const result = buildTypeRemediation(error);
    expect(result.length).toBeGreaterThan(0);
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

  it("includes file location when available", () => {
    const error: GateError = {
      file: "src/foo.ts",
      line: 10,
      message: "error lint/style/useConst",
    };
    const result = buildLintRemediation(error);
    expect(result).toContain("src/foo.ts:10");
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

  it("returns remediation containing 'null' or 'function' for TypeError", () => {
    const error: GateError = {
      message: "TypeError: Cannot read property 'foo' of null",
    };
    const result = buildTestRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/null|function/i);
  });

  it("returns non-empty string for FAIL line", () => {
    const error: GateError = {
      file: "src/foo.test.ts",
      message: "FAIL src/foo.test.ts > suite > test name",
    };
    const result = buildTestRemediation(error);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns remediation containing 'timeout' for timeout errors", () => {
    const error: GateError = {
      message: "Test timed out after 5000ms",
    };
    const result = buildTestRemediation(error);
    expect(result).toBeTruthy();
    expect(result).toMatch(/timeout/i);
  });

  it("returns non-empty fallback for generic test failure", () => {
    const error: GateError = {
      message: "something obscure happened in the test",
    };
    const result = buildTestRemediation(error);
    expect(result.length).toBeGreaterThan(0);
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

  it("returns string containing 'mobile' or 'viewport' for mobile errors", () => {
    const error: GateError = {
      message: "Button not visible on mobile",
    };
    const result = buildVisualRemediation(error);
    expect(result).toMatch(/mobile|viewport/i);
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

  it("combines multiple matching hints", () => {
    const error: GateError = {
      message: "overflow detected on mobile viewport",
    };
    const result = buildVisualRemediation(error);
    // Should match both overflow and mobile patterns
    expect(result).toMatch(/overflow/i);
    expect(result).toMatch(/mobile|viewport/i);
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

  it("returns non-empty fallback for error with no special references", () => {
    const error: GateError = {
      message: "Code quality issue found in module",
    };
    const result = buildReviewRemediation(error);
    expect(result.length).toBeGreaterThan(0);
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
    expect(result).toContain("/forge:setup");
  });

  it("returns baseline remediation for 'no tests found' message", () => {
    const error: GateError = {
      message: "No tests found. 5 source files across 2 categories have no test coverage.",
    };
    const result = buildTestCoverageRemediation(error);
    expect(result).toMatch(/no tests exist/i);
    expect(result).toContain("/forge:setup");
  });

  it("returns thin coverage remediation for 'thin coverage' message", () => {
    const error: GateError = {
      message: "Thin coverage: ratio 0.1 (1 test file for 10 source files)",
    };
    const result = buildTestCoverageRemediation(error);
    expect(result).toMatch(/coverage is very low/i);
    expect(result).toMatch(/critical paths/i);
  });

  it("returns generic fallback for unrecognized coverage error", () => {
    const error: GateError = {
      message: "Some other coverage-related problem",
    };
    const result = buildTestCoverageRemediation(error);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("/forge:setup");
  });

  it("includes file location prefix when file is provided", () => {
    const error: GateError = {
      file: "src/utils.ts",
      line: 1,
      message: "Missing test file for changed source: src/utils.ts",
    };
    const result = buildTestCoverageRemediation(error);
    expect(result).toContain("src/utils.ts:1");
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

    // Should have two remediation blocks
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
              // No remediation field
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

// ---------------------------------------------------------------------------
// Part 3: Gate enrichment integration
// ---------------------------------------------------------------------------

// We need to mock node:child_process for the gate imports.
// Each gate test section uses a fresh describe block with its own mock setup.

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../src/gates/test-analysis.js", () => ({
  analyzeTestCoverage: vi.fn(),
}));

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

import { execSync } from "node:child_process";
import { verifyTypes } from "../../src/gates/types-gate.js";
import { verifyLint } from "../../src/gates/lint-gate.js";
import { verifyTests } from "../../src/gates/tests-gate.js";
import { analyzeTestCoverage } from "../../src/gates/test-analysis.js";
import { loadConfig } from "../../src/config/loader.js";

const mockExecSync = vi.mocked(execSync);
const mockAnalyzeTestCoverage = vi.mocked(analyzeTestCoverage);
const mockLoadConfig = vi.mocked(loadConfig);

describe("Gate enrichment: verifyTypes populates remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enriches TS2322 errors with remediation field", async () => {
    const tscOutput = [
      "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    ].join("\n");

    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(tscOutput),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyTypes("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].remediation).toBeDefined();
    expect(result.errors[0].remediation!.length).toBeGreaterThan(0);
    expect(result.errors[0].remediation).toMatch(/assignable|type/i);
  });

  it("enriches TS2304 errors with remediation field", async () => {
    const tscOutput = [
      "src/bar.ts(42,1): error TS2304: Cannot find name 'baz'.",
    ].join("\n");

    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(tscOutput),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyTypes("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].remediation).toBeDefined();
    expect(result.errors[0].remediation!.length).toBeGreaterThan(0);
    expect(result.errors[0].remediation).toMatch(/name|import/i);
  });

  it("enriches multiple errors each with remediation", async () => {
    const tscOutput = [
      "src/a.ts(1,1): error TS2322: Type mismatch.",
      "src/b.ts(2,1): error TS2304: Cannot find name 'x'.",
    ].join("\n");

    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(tscOutput),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyTypes("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
    for (const err of result.errors) {
      expect(err.remediation).toBeDefined();
      expect(err.remediation!.length).toBeGreaterThan(0);
    }
  });
});

describe("Gate enrichment: verifyLint populates remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enriches lint errors with remediation field", async () => {
    const biomeOutput = [
      "src/app.ts:10:5 error lint/style/useConst",
    ].join("\n");

    const error = Object.assign(new Error("biome check failed"), {
      stdout: Buffer.from(biomeOutput),
      stderr: Buffer.from(""),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].remediation).toBeDefined();
    expect(result.errors[0].remediation!.length).toBeGreaterThan(0);
    expect(result.errors[0].remediation).toMatch(/const/i);
  });

  it("enriches multiple lint errors each with remediation", async () => {
    const biomeOutput = [
      "src/a.ts:1:1 error lint/style/useConst",
      "src/b.ts:2:1 error no-unused-vars x is unused",
    ].join("\n");

    const error = Object.assign(new Error("biome check failed"), {
      stdout: Buffer.from(biomeOutput),
      stderr: Buffer.from(""),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    for (const err of result.errors) {
      expect(err.remediation).toBeDefined();
      expect(err.remediation!.length).toBeGreaterThan(0);
    }
  });
});

describe("Gate enrichment: verifyTests populates remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide defaults so verifyTests' new dependencies work
    mockAnalyzeTestCoverage.mockResolvedValue({
      framework: { testRunner: "vitest", appFramework: "plain-ts", detectedPatterns: [] },
      coverage: { sourceFiles: 5, testFiles: 3, ratio: 0.6, untestedFiles: [] },
      categories: [],
    });
    mockLoadConfig.mockReturnValue({
      gates: ["types", "lint", "tests"],
      maxIterations: 5,
      verifyFreshness: 600_000,
    });
  });

  it("enriches test failure errors with remediation field", async () => {
    const testOutput = [
      "FAIL src/foo.test.ts > suite > test name",
      "  Expected: 1",
      "  Received: 2",
    ].join("\n");

    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      const error = Object.assign(new Error("tests failed"), {
        stdout: Buffer.from(testOutput),
        stderr: Buffer.from(""),
        status: 1,
      });
      throw error;
    });

    const result = await verifyTests("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    // Every error should have remediation populated
    for (const err of result.errors) {
      expect(err.remediation).toBeDefined();
      expect(err.remediation!.length).toBeGreaterThan(0);
    }
  });

  it("enriches timeout test errors with remediation containing 'timeout'", async () => {
    const testOutput = [
      "FAIL src/slow.test.ts > suite > slow test",
      "  Error: Test timeout of 5000ms exceeded",
    ].join("\n");

    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      const error = Object.assign(new Error("tests failed"), {
        stdout: Buffer.from(testOutput),
        stderr: Buffer.from(""),
        status: 1,
      });
      throw error;
    });

    const result = await verifyTests("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    for (const err of result.errors) {
      expect(err.remediation).toBeDefined();
      expect(err.remediation!.length).toBeGreaterThan(0);
    }
  });
});
