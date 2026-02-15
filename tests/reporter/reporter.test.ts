import { describe, it, expect } from "vitest";
import { formatHumanReport } from "../../src/reporter/human.js";
import { formatJsonReport } from "../../src/reporter/json.js";
import type { PipelineResult, GateResult } from "../../src/types.js";

function makeGate(overrides: Partial<GateResult> = {}): GateResult {
  return {
    gate: "types",
    passed: true,
    errors: [],
    warnings: [],
    duration_ms: 1500,
    ...overrides,
  };
}

function makePipeline(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    passed: true,
    iteration: 1,
    maxIterations: 5,
    gates: [],
    report: "",
    ...overrides,
  };
}

describe("formatHumanReport", () => {
  it("generates markdown with all checkboxes checked for passing pipeline", () => {
    const result = makePipeline({
      passed: true,
      gates: [
        makeGate({ gate: "types", passed: true, duration_ms: 2000 }),
        makeGate({ gate: "lint", passed: true, duration_ms: 1000 }),
        makeGate({ gate: "tests", passed: true, duration_ms: 3000 }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("## Verification Report");
    expect(report).toContain("**Status:** PASSED");
    expect(report).toContain("**Iterations:** 1/5");
    expect(report).toContain("- [x] types: PASS");
    expect(report).toContain("- [x] lint: PASS");
    expect(report).toContain("- [x] tests: PASS");
    // Should not contain Errors section
    expect(report).not.toContain("### Errors");
  });

  it("generates markdown with unchecked boxes for failing gates", () => {
    const result = makePipeline({
      passed: false,
      gates: [
        makeGate({ gate: "types", passed: true, duration_ms: 2000 }),
        makeGate({
          gate: "lint",
          passed: false,
          duration_ms: 1000,
          errors: [
            { file: "src/app.ts", line: 10, message: "no-unused-vars" },
            { file: "src/utils.ts", line: 5, message: "no-console" },
          ],
        }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("**Status:** FAILED");
    expect(report).toContain("- [x] types: PASS");
    expect(report).toContain("- [ ] lint: FAIL");
    expect(report).toContain("2 errors");
    expect(report).toContain("### Errors");
    expect(report).toContain("#### lint");
    expect(report).toContain("src/app.ts:10: no-unused-vars");
    expect(report).toContain("src/utils.ts:5: no-console");
  });

  it("displays remediation hints when provided", () => {
    const result = makePipeline({
      passed: false,
      gates: [
        makeGate({
          gate: "types",
          passed: false,
          errors: [
            {
              file: "src/foo.ts",
              line: 5,
              message: "TS2322: type mismatch",
              remediation: "Change the type to string",
            },
          ],
        }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("> Fix: Change the type to string");
  });

  it("displays warnings section when gates have warnings", () => {
    const result = makePipeline({
      passed: true,
      gates: [
        makeGate({
          gate: "tests",
          passed: true,
          warnings: ["12 passed, 0 failed"],
        }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("### Warnings");
    expect(report).toContain("#### tests");
    expect(report).toContain("12 passed, 0 failed");
    expect(report).toContain("1 warning");
  });

  it("formats duration correctly", () => {
    const result = makePipeline({
      passed: true,
      gates: [
        makeGate({ duration_ms: 2500 }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("**Duration:** 2.5s");
  });

  it("handles errors without file location", () => {
    const result = makePipeline({
      passed: false,
      gates: [
        makeGate({
          gate: "types",
          passed: false,
          errors: [{ message: "tsc exited with non-zero status" }],
        }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("- tsc exited with non-zero status");
  });

  it("shows singular 'error' for single error count", () => {
    const result = makePipeline({
      passed: false,
      gates: [
        makeGate({
          gate: "lint",
          passed: false,
          errors: [{ message: "one error" }],
        }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("1 error");
    expect(report).not.toContain("1 errors");
  });
});

describe("formatJsonReport", () => {
  it("returns valid JSON matching the PipelineResult structure", () => {
    const result = makePipeline({
      passed: true,
      iteration: 2,
      maxIterations: 5,
      gates: [
        makeGate({ gate: "types", passed: true }),
        makeGate({ gate: "lint", passed: true }),
      ],
    });

    const jsonStr = formatJsonReport(result);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.passed).toBe(true);
    expect(parsed.iteration).toBe(2);
    expect(parsed.maxIterations).toBe(5);
    expect(parsed.gates).toHaveLength(2);
    expect(parsed.gates[0].gate).toBe("types");
    expect(parsed.gates[1].gate).toBe("lint");
  });

  it("produces pretty-printed JSON with 2-space indentation", () => {
    const result = makePipeline({ passed: true, gates: [] });
    const jsonStr = formatJsonReport(result);

    // Pretty printed JSON starts with {\n and has 2-space indentation
    expect(jsonStr).toContain("  ");
    expect(jsonStr).toBe(JSON.stringify(result, null, 2));
  });

  it("preserves all gate error details in JSON output", () => {
    const result = makePipeline({
      passed: false,
      gates: [
        makeGate({
          gate: "types",
          passed: false,
          errors: [
            { file: "src/foo.ts", line: 10, message: "type error", remediation: "fix it" },
          ],
          warnings: ["some warning"],
        }),
      ],
    });

    const parsed = JSON.parse(formatJsonReport(result));

    expect(parsed.gates[0].errors[0]).toEqual({
      file: "src/foo.ts",
      line: 10,
      message: "type error",
      remediation: "fix it",
    });
    expect(parsed.gates[0].warnings).toEqual(["some warning"]);
  });
});
