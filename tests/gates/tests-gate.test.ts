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
    mockAnalyzeTestCoverage.mockResolvedValue(defaultAnalysisReport());
    mockLoadConfig.mockReturnValue(defaultConfig());
  });

  it("returns passed: true when all tests pass", async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      return Buffer.from("Tests 12 passed");
    });

    const result = await verifyTests("/fake/project");

    expect(result.gate).toBe("tests");
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
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
    const failError = result.errors.find((e) => e.message.includes("FAIL"));
    expect(failError).toBeDefined();
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
        return Buffer.from("Tests 5 passed");
      });

      const result = await verifyTests("/fake/project");

      expect(result.passed).toBe(false);
      const enforcementError = result.errors.find((e) =>
        e.message.includes("Missing test file") && e.message.includes("new-feature"),
      );
      expect(enforcementError).toBeDefined();
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
            untestedFiles: [],
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
        return Buffer.from("Tests 10 passed");
      });

      const result = await verifyTests("/fake/project");

      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
