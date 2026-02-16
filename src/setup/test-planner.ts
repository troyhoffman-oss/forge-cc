// ── Test Planner ────────────────────────────────────────────────────
// Interactive test planning module for /forge:setup integration.
// Analyzes project test coverage, then builds a scaffold plan + config
// from user-confirmed categories.

import type { TestAnalysisReport } from "../gates/test-analysis.js";
import type { TestingConfig } from "../types.js";
import { analyzeTestCoverage } from "../gates/test-analysis.js";
import { buildScaffoldPlan } from "./test-scaffold.js";
import type { ScaffoldPlan } from "./test-scaffold.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestPlanningData {
  /** The test analysis report from scanning the project */
  report: TestAnalysisReport;
  /** Human-readable summary of findings */
  summary: string;
  /** Per-category summaries for user confirmation prompts */
  categorySummaries: CategorySummary[];
}

export interface CategorySummary {
  name: string;
  sourceCount: number;
  testCount: number;
  untestedCount: number;
  description: string;
}

export interface TestPlannerResult {
  /** The test analysis report from scanning the project */
  report: TestAnalysisReport;
  /** Categories the user confirmed for test scaffolding */
  confirmedCategories: string[];
  /** The chosen test runner */
  runner: "vitest" | "jest";
  /** The test directory */
  testDir: string;
  /** Whether structural tests are included */
  structural: boolean;
  /** The generated testing config to persist to .forge.json */
  testingConfig: TestingConfig;
  /** The scaffold plan (ready to execute) */
  scaffoldPlan: ScaffoldPlan;
}

// ---------------------------------------------------------------------------
// Category Description Helpers
// ---------------------------------------------------------------------------

function describeCategoryName(name: string): string {
  switch (name) {
    case "api-routes":
      return "API routes and endpoint handlers";
    case "components":
      return "UI components (React/TSX)";
    case "utils":
      return "Utility functions and helpers";
    case "middleware":
      return "Middleware and interceptors";
    case "models":
      return "Data models, schemas, and entities";
    case "other":
      return "Other source files";
    default:
      return name;
  }
}

// ---------------------------------------------------------------------------
// Analysis Phase
// ---------------------------------------------------------------------------

/** Analyze the project and prepare the test planning data. */
export async function analyzeForTestPlanning(
  projectDir: string,
): Promise<TestPlanningData> {
  const report = await analyzeTestCoverage(projectDir);

  const categorySummaries: CategorySummary[] = report.categories.map((cat) => ({
    name: cat.name,
    sourceCount: cat.sourceFiles.length,
    testCount: cat.testFiles.length,
    untestedCount: cat.untestedFiles.length,
    description: describeCategoryName(cat.name),
  }));

  const lines: string[] = [];
  lines.push(`Framework: ${report.framework.appFramework}`);
  lines.push(`Test runner: ${report.framework.testRunner}`);
  lines.push(
    `Coverage: ${report.coverage.testFiles} test files / ${report.coverage.sourceFiles} source files (ratio: ${report.coverage.ratio})`,
  );

  if (report.framework.detectedPatterns.length > 0) {
    lines.push(`Detected: ${report.framework.detectedPatterns.join(", ")}`);
  }

  if (categorySummaries.length > 0) {
    lines.push("");
    lines.push("Categories:");
    for (const cat of categorySummaries) {
      lines.push(
        `  - ${cat.name}: ${cat.sourceCount} source, ${cat.testCount} tested, ${cat.untestedCount} untested`,
      );
    }
  }

  return {
    report,
    summary: lines.join("\n"),
    categorySummaries,
  };
}

// ---------------------------------------------------------------------------
// Plan Building Phase
// ---------------------------------------------------------------------------

/** Build the final plan + config after user confirms categories. */
export async function buildTestPlan(
  report: TestAnalysisReport,
  confirmedCategories: string[],
  runner: "vitest" | "jest",
  testDir: string,
  structural: boolean,
  projectDir: string,
): Promise<TestPlannerResult> {
  const scaffoldPlan = await buildScaffoldPlan(report, {
    projectDir,
    testDir,
    runner,
    structural,
    categories: confirmedCategories,
  });

  const testingConfig: TestingConfig = {
    enforce: true,
    runner,
    testDir,
    sourceDir: "src",
    structural,
    categories: confirmedCategories,
  };

  return {
    report,
    confirmedCategories,
    runner,
    testDir,
    structural,
    testingConfig,
    scaffoldPlan,
  };
}
