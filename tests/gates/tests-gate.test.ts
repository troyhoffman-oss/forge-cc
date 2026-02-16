import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { verifyTests } from "../../src/gates/tests-gate.js";
import { analyzeTestCoverage } from "../../src/gates/test-analysis.js";
import { loadConfig } from "../../src/config/loader.js";
import type { TestAnalysisReport } from "../../src/gates/test-analysis.js";
import type { ForgeConfig } from "../../src/types.js";

const mockExecSync = vi.mocked(execSync);
const mockAnalyzeTestCoverage = vi.mocked(analyzeTestCoverage);
const mockLoadConfig = vi.mocked(loadConfig);

// ---------------------------------------------------------------------------
// Default mock return values (used for existing tests that don't care about
// the new analysis/config features)
// ---------------------------------------------------------------------------

function defaultAnalysisReport(overrides: Partial<TestAnalysisReport> = {}): TestAnalysisReport {
  return {
    framework: {
      testRunner: "vitest",
      appFramework: "plain-ts",
      detectedPatterns: ["vitest in dependencies"],
    },
    coverage: {
      sourceFiles: 5,
      testFiles: 3,
      ratio: 0.6,
      untestedFiles: [],
    },
    categories: [],
    ...overrides,
  };
}

function defaultConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    gates: ["types", "lint", "tests"],
    maxIterations: 5,
    verifyFreshness: 600_000,
    ...overrides,
  };
}

describe("verifyTests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up sensible defaults so existing tests continue to work
    mockAnalyzeTestCoverage.mockResolvedValue(defaultAnalysisReport());
    mockLoadConfig.mockReturnValue(defaultConfig());
  });

  it("returns passed: true when all tests pass", async () => {
    // First call: reads package.json (has test script)
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      // Second call: runs tests
      return Buffer.from("Tests 12 passed");
    });

    const result = await verifyTests("/fake/project");

    expect(result.gate).toBe("tests");
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("includes test summary in warnings on success", async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      return Buffer.from("Tests 12 passed | 0 failed");
    });

    const result = await verifyTests("/fake/project");

    expect(result.passed).toBe(true);
    expect(result.warnings).toContain("12 passed, 0 failed");
  });

  it("parses test failures into GateError objects", async () => {
    const testOutput = [
      "FAIL src/foo.test.ts > suite > test name",
      "  at src/foo.test.ts:42:10",
      "  Expected: 1",
      "  Received: 2",
      "",
      "Tests 3 passed | 1 failed",
    ].join("\n");

    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      // Test run fails
      const error = Object.assign(new Error("tests failed"), {
        stdout: Buffer.from(testOutput),
        stderr: Buffer.from(""),
        status: 1,
      });
      throw error;
    });

    const result = await verifyTests("/fake/project");

    expect(result.gate).toBe("tests");
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    // Should have FAIL and Expected/Received lines as errors
    const failError = result.errors.find((e) => e.message.includes("FAIL"));
    expect(failError).toBeDefined();
  });

  it("includes test summary in warnings even on failure", async () => {
    const testOutput = [
      "FAIL src/foo.test.ts > test",
      "Tests 3 passed | 2 failed",
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
    expect(result.warnings).toContain("3 passed, 2 failed");
  });

  it("returns fallback error when test runner fails with no parseable output", async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      const error = Object.assign(new Error("tests crashed"), {
        stdout: Buffer.from("something went wrong\n"),
        stderr: Buffer.from(""),
        status: 1,
      });
      throw error;
    });

    const result = await verifyTests("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("Test runner exited with non-zero status");
  });

  // -----------------------------------------------------------------------
  // Baseline check tests
  // -----------------------------------------------------------------------

  describe("baseline check", () => {
    it("returns passed: false when zero test files AND no test script", async () => {
      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 5,
            testFiles: 0,
            ratio: 0,
            untestedFiles: ["src/a.ts", "src/b.ts"],
          },
          categories: [{ name: "other", sourceFiles: ["src/a.ts", "src/b.ts"], testFiles: [], untestedFiles: ["src/a.ts", "src/b.ts"] }],
        }),
      );

      // No test script in package.json
      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: {} }));
        }
        return Buffer.from("");
      });

      const result = await verifyTests("/fake/project");

      expect(result.gate).toBe("tests");
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].message).toMatch(/no tests found/i);
      expect(result.errors[0].remediation).toBeDefined();
    });

    it("returns passed: false when zero test files but test script exists", async () => {
      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 3,
            testFiles: 0,
            ratio: 0,
            untestedFiles: ["src/a.ts"],
          },
          categories: [],
        }),
      );

      // Has test script but zero test files
      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
        }
        return Buffer.from("");
      });

      const result = await verifyTests("/fake/project");

      expect(result.gate).toBe("tests");
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].message).toMatch(/no test files found/i);
      expect(result.errors[0].remediation).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Enforcement check tests
  // -----------------------------------------------------------------------

  describe("enforcement check", () => {
    it("fails if changed files lack tests when enforce is true", async () => {
      mockLoadConfig.mockReturnValue(
        defaultConfig({
          testing: {
            enforce: true,
            runner: "vitest",
            testDir: "tests",
            sourceDir: "src",
            structural: true,
            categories: [],
          },
        }),
      );

      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 5,
            testFiles: 2,
            ratio: 0.4,
            untestedFiles: ["src/new-feature.ts", "src/another.ts"],
          },
        }),
      );

      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
        }
        if (command.includes("git diff")) {
          return Buffer.from("src/new-feature.ts\nsrc/existing.ts\n");
        }
        // Test run passes
        return Buffer.from("Tests 5 passed");
      });

      const result = await verifyTests("/fake/project");

      expect(result.passed).toBe(false);
      // Should have an error for src/new-feature.ts (changed + untested)
      const enforcementError = result.errors.find((e) =>
        e.message.includes("Missing test file") && e.message.includes("new-feature"),
      );
      expect(enforcementError).toBeDefined();
      expect(enforcementError!.remediation).toBeDefined();
    });

    it("passes when all changed files have tests", async () => {
      mockLoadConfig.mockReturnValue(
        defaultConfig({
          testing: {
            enforce: true,
            runner: "vitest",
            testDir: "tests",
            sourceDir: "src",
            structural: true,
            categories: [],
          },
        }),
      );

      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 5,
            testFiles: 5,
            ratio: 1.0,
            untestedFiles: [], // All files have tests
          },
        }),
      );

      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
        }
        if (command.includes("git diff")) {
          return Buffer.from("src/covered.ts\n");
        }
        // Test run passes
        return Buffer.from("Tests 10 passed");
      });

      const result = await verifyTests("/fake/project");

      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("does not enforce when testing.enforce is false", async () => {
      mockLoadConfig.mockReturnValue(
        defaultConfig({
          testing: {
            enforce: false,
            runner: "vitest",
            testDir: "tests",
            sourceDir: "src",
            structural: true,
            categories: [],
          },
        }),
      );

      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 5,
            testFiles: 1,
            ratio: 0.2,
            untestedFiles: ["src/untested.ts"],
          },
        }),
      );

      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
        }
        // Tests pass
        return Buffer.from("Tests 1 passed");
      });

      const result = await verifyTests("/fake/project");

      // Should pass because enforcement is off (even though coverage is low)
      expect(result.passed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Thin coverage advisory tests
  // -----------------------------------------------------------------------

  describe("thin coverage advisory", () => {
    it("adds warning when coverage ratio < 0.3", async () => {
      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 10,
            testFiles: 2,
            ratio: 0.2,
            untestedFiles: [],
          },
        }),
      );

      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
        }
        return Buffer.from("Tests 5 passed");
      });

      const result = await verifyTests("/fake/project");

      expect(result.passed).toBe(true);
      const thinWarning = result.warnings.find((w) => w.includes("Thin test coverage"));
      expect(thinWarning).toBeDefined();
    });

    it("no thin coverage warning when ratio >= 0.3", async () => {
      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 10,
            testFiles: 5,
            ratio: 0.5,
            untestedFiles: [],
          },
        }),
      );

      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
        }
        return Buffer.from("Tests 10 passed");
      });

      const result = await verifyTests("/fake/project");

      expect(result.passed).toBe(true);
      const thinWarning = result.warnings.find((w) => w.includes("Thin test coverage"));
      expect(thinWarning).toBeUndefined();
    });

    it("no thin coverage warning when testFiles is 0 (baseline already handles)", async () => {
      // When testFiles is 0, the baseline check fires first and returns early.
      // This test verifies thin coverage logic doesn't trigger for 0 test files
      // when there IS a test script (baseline will fail first).
      mockAnalyzeTestCoverage.mockResolvedValue(
        defaultAnalysisReport({
          coverage: {
            sourceFiles: 10,
            testFiles: 0,
            ratio: 0,
            untestedFiles: [],
          },
          categories: [],
        }),
      );

      mockExecSync.mockImplementation((cmd: unknown) => {
        const command = String(cmd);
        if (command.includes("package.json")) {
          return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
        }
        return Buffer.from("");
      });

      const result = await verifyTests("/fake/project");

      // Baseline failure kicks in first
      expect(result.passed).toBe(false);
      // Thin coverage warning should NOT appear (baseline handles this)
      const thinWarning = result.warnings.find((w) => w.includes("Thin test coverage"));
      expect(thinWarning).toBeUndefined();
    });
  });
});
