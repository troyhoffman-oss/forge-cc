import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestAnalysisReport, TestCategory } from "../../src/gates/test-analysis.js";
import type { ScaffoldPlan } from "../../src/setup/test-scaffold.js";

// Mock external dependencies before importing the module under test
vi.mock("../../src/gates/test-analysis.js", () => ({
  analyzeTestCoverage: vi.fn(),
}));

vi.mock("../../src/setup/test-scaffold.js", () => ({
  buildScaffoldPlan: vi.fn(),
}));

import { analyzeForTestPlanning, buildTestPlan } from "../../src/setup/test-planner.js";
import { analyzeTestCoverage } from "../../src/gates/test-analysis.js";
import { buildScaffoldPlan } from "../../src/setup/test-scaffold.js";

const mockAnalyzeTestCoverage = vi.mocked(analyzeTestCoverage);
const mockBuildScaffoldPlan = vi.mocked(buildScaffoldPlan);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCategory(
  name: string,
  sourceFiles: string[],
  testFiles: string[],
  untestedFiles: string[],
): TestCategory {
  return { name, sourceFiles, testFiles, untestedFiles };
}

function makeReport(overrides: {
  testRunner?: "vitest" | "jest" | "none";
  appFramework?: TestAnalysisReport["framework"]["appFramework"];
  detectedPatterns?: string[];
  categories?: TestCategory[];
  sourceFiles?: number;
  testFiles?: number;
  ratio?: number;
}): TestAnalysisReport {
  const categories = overrides.categories ?? [];
  return {
    framework: {
      testRunner: overrides.testRunner ?? "vitest",
      appFramework: overrides.appFramework ?? "plain-ts",
      detectedPatterns: overrides.detectedPatterns ?? [],
    },
    coverage: {
      sourceFiles: overrides.sourceFiles ?? categories.reduce((n, c) => n + c.sourceFiles.length, 0),
      testFiles: overrides.testFiles ?? categories.reduce((n, c) => n + c.testFiles.length, 0),
      ratio: overrides.ratio ?? 0.5,
      untestedFiles: categories.flatMap((c) => c.untestedFiles),
    },
    categories,
  };
}

const emptyScaffoldPlan: ScaffoldPlan = {
  configFile: null,
  packageJsonUpdates: {},
  testFiles: [],
  structuralTests: [],
};

// ===========================================================================
// analyzeForTestPlanning
// ===========================================================================

describe("analyzeForTestPlanning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct summary with framework, runner, and coverage info", async () => {
    const report = makeReport({
      appFramework: "nextjs-app",
      testRunner: "vitest",
      sourceFiles: 10,
      testFiles: 5,
      ratio: 0.5,
      categories: [
        makeCategory("utils", ["src/a.ts", "src/b.ts"], ["tests/a.test.ts"], ["src/b.ts"]),
      ],
    });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.summary).toContain("Framework: nextjs-app");
    expect(result.summary).toContain("Test runner: vitest");
    expect(result.summary).toContain("Coverage: 5 test files / 10 source files (ratio: 0.5)");
  });

  it("builds category summaries from report categories", async () => {
    const report = makeReport({
      categories: [
        makeCategory("utils", ["src/a.ts", "src/b.ts"], ["tests/a.test.ts"], ["src/b.ts"]),
        makeCategory("api-routes", ["src/api/x.ts"], [], ["src/api/x.ts"]),
      ],
    });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.categorySummaries).toHaveLength(2);

    const utilsSummary = result.categorySummaries[0];
    expect(utilsSummary.name).toBe("utils");
    expect(utilsSummary.sourceCount).toBe(2);
    expect(utilsSummary.testCount).toBe(1);
    expect(utilsSummary.untestedCount).toBe(1);

    const apiSummary = result.categorySummaries[1];
    expect(apiSummary.name).toBe("api-routes");
    expect(apiSummary.sourceCount).toBe(1);
    expect(apiSummary.testCount).toBe(0);
    expect(apiSummary.untestedCount).toBe(1);
  });

  it("maps known category names to human-readable descriptions", async () => {
    const report = makeReport({
      categories: [
        makeCategory("api-routes", ["src/api/x.ts"], [], []),
        makeCategory("components", ["src/ui/y.tsx"], [], []),
        makeCategory("utils", ["src/utils/z.ts"], [], []),
        makeCategory("middleware", ["src/mw/a.ts"], [], []),
        makeCategory("models", ["src/models/b.ts"], [], []),
        makeCategory("other", ["src/config.ts"], [], []),
      ],
    });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    const descriptions = result.categorySummaries.map((c) => c.description);
    expect(descriptions).toContain("API routes and endpoint handlers");
    expect(descriptions).toContain("UI components (React/TSX)");
    expect(descriptions).toContain("Utility functions and helpers");
    expect(descriptions).toContain("Middleware and interceptors");
    expect(descriptions).toContain("Data models, schemas, and entities");
    expect(descriptions).toContain("Other source files");
  });

  it("uses category name as description for unknown categories", async () => {
    const report = makeReport({
      categories: [
        makeCategory("custom-stuff", ["src/x.ts"], [], []),
      ],
    });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.categorySummaries[0].description).toBe("custom-stuff");
  });

  it("handles empty categories", async () => {
    const report = makeReport({ categories: [] });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.categorySummaries).toEqual([]);
    expect(result.summary).not.toContain("Categories:");
  });

  it("includes detected patterns in summary", async () => {
    const report = makeReport({
      detectedPatterns: ["vitest in dependencies", "tsconfig.json found"],
    });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.summary).toContain("Detected: vitest in dependencies, tsconfig.json found");
  });

  it("omits detected patterns line when none are detected", async () => {
    const report = makeReport({ detectedPatterns: [] });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.summary).not.toContain("Detected:");
  });

  it("includes categories section in summary when categories exist", async () => {
    const report = makeReport({
      categories: [
        makeCategory("utils", ["src/a.ts"], ["tests/a.test.ts"], []),
      ],
    });
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.summary).toContain("Categories:");
    expect(result.summary).toContain("  - utils: 1 source, 1 tested, 0 untested");
  });

  it("returns the raw report from analyzeTestCoverage", async () => {
    const report = makeReport({});
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    const result = await analyzeForTestPlanning("/project");

    expect(result.report).toBe(report);
  });

  it("passes the projectDir to analyzeTestCoverage", async () => {
    const report = makeReport({});
    mockAnalyzeTestCoverage.mockResolvedValue(report);

    await analyzeForTestPlanning("/my/project");

    expect(mockAnalyzeTestCoverage).toHaveBeenCalledWith("/my/project");
  });
});

// ===========================================================================
// buildTestPlan
// ===========================================================================

describe("buildTestPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes confirmed categories to buildScaffoldPlan", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    await buildTestPlan(report, ["utils", "api-routes"], "vitest", "tests", true, "/project");

    expect(mockBuildScaffoldPlan).toHaveBeenCalledWith(report, {
      projectDir: "/project",
      testDir: "tests",
      runner: "vitest",
      structural: true,
      categories: ["utils", "api-routes"],
    });
  });

  it("generates TestingConfig with enforce=true", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    const result = await buildTestPlan(report, ["utils"], "vitest", "tests", false, "/project");

    expect(result.testingConfig.enforce).toBe(true);
  });

  it("uses provided runner in TestingConfig", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    const result = await buildTestPlan(report, [], "jest", "tests", false, "/project");

    expect(result.testingConfig.runner).toBe("jest");
  });

  it("uses provided testDir in TestingConfig", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    const result = await buildTestPlan(report, [], "vitest", "spec", false, "/project");

    expect(result.testingConfig.testDir).toBe("spec");
  });

  it("uses provided structural value in TestingConfig", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    const result = await buildTestPlan(report, [], "vitest", "tests", true, "/project");

    expect(result.testingConfig.structural).toBe(true);
  });

  it("sets sourceDir to 'src' in TestingConfig", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    const result = await buildTestPlan(report, [], "vitest", "tests", false, "/project");

    expect(result.testingConfig.sourceDir).toBe("src");
  });

  it("sets categories in TestingConfig from confirmedCategories", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    const result = await buildTestPlan(report, ["utils", "models"], "vitest", "tests", false, "/project");

    expect(result.testingConfig.categories).toEqual(["utils", "models"]);
  });

  it("returns the scaffold plan from buildScaffoldPlan", async () => {
    const report = makeReport({});
    const customPlan: ScaffoldPlan = {
      configFile: { path: "vitest.config.ts", content: "// config" },
      packageJsonUpdates: { scripts: { test: "vitest run" } },
      testFiles: [{ path: "tests/a.test.ts", content: "// a" }],
      structuralTests: [],
    };
    mockBuildScaffoldPlan.mockResolvedValue(customPlan);

    const result = await buildTestPlan(report, ["utils"], "vitest", "tests", false, "/project");

    expect(result.scaffoldPlan).toBe(customPlan);
  });

  it("returns all input values in the result", async () => {
    const report = makeReport({});
    mockBuildScaffoldPlan.mockResolvedValue(emptyScaffoldPlan);

    const result = await buildTestPlan(report, ["utils"], "jest", "spec", true, "/project");

    expect(result.report).toBe(report);
    expect(result.confirmedCategories).toEqual(["utils"]);
    expect(result.runner).toBe("jest");
    expect(result.testDir).toBe("spec");
    expect(result.structural).toBe(true);
  });
});
