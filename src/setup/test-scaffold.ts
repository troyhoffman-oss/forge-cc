// ── Test Scaffold Engine ────────────────────────────────────────────
// Orchestrator that takes a TestAnalysisReport + options and produces
// a ScaffoldPlan: config files, package.json updates, unit test stubs,
// and structural test stubs. Can also execute the plan to disk.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, basename, extname } from "node:path";

import type { TestAnalysisReport } from "../gates/test-analysis.js";
import type { TestingConfig } from "../types.js";
import { generateTestTemplate } from "./test-templates.js";
import { generateStructuralTests } from "./structural-templates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldPlan {
  configFile: { path: string; content: string } | null;
  packageJsonUpdates: {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  testFiles: Array<{ path: string; content: string }>;
  structuralTests: Array<{ path: string; content: string }>;
}

export interface ScaffoldOptions {
  projectDir: string;
  testDir?: string;
  runner?: "vitest" | "jest";
  structural?: boolean;
  categories?: string[];
  entryPoints?: string[];
}

// ---------------------------------------------------------------------------
// Config Generation
// ---------------------------------------------------------------------------

function needsJsdom(report: TestAnalysisReport): boolean {
  const fw = report.framework.appFramework;
  return fw === "nextjs-app" || fw === "nextjs-pages" || fw === "react-vite";
}

function generateVitestConfig(
  report: TestAnalysisReport,
  testDir: string,
): string {
  const lines: string[] = [];
  lines.push(`import { defineConfig } from "vitest/config";`);
  lines.push(``);
  lines.push(`export default defineConfig({`);
  lines.push(`  test: {`);
  lines.push(`    include: ["${testDir}/**/*.test.ts", "${testDir}/**/*.test.tsx"],`);

  if (needsJsdom(report)) {
    lines.push(`    environment: "jsdom",`);
  }

  lines.push(`    coverage: {`);
  lines.push(`      provider: "v8",`);
  lines.push(`      include: ["src/**/*.ts", "src/**/*.tsx"],`);
  lines.push(`      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.d.ts"],`);
  lines.push(`    },`);
  lines.push(`  },`);
  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}

function generateJestConfig(
  report: TestAnalysisReport,
  testDir: string,
): string {
  const lines: string[] = [];
  lines.push(`import type { Config } from "jest";`);
  lines.push(``);
  lines.push(`const config: Config = {`);
  lines.push(`  testMatch: ["<rootDir>/${testDir}/**/*.test.ts", "<rootDir>/${testDir}/**/*.test.tsx"],`);
  lines.push(`  transform: {`);
  lines.push(`    "^.+\\\\.tsx?$": "ts-jest",`);
  lines.push(`  },`);

  if (needsJsdom(report)) {
    lines.push(`  testEnvironment: "jsdom",`);
  }

  lines.push(`};`);
  lines.push(``);
  lines.push(`export default config;`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Package.json Updates
// ---------------------------------------------------------------------------

function buildPackageJsonUpdates(
  runner: "vitest" | "jest",
  report: TestAnalysisReport,
): { scripts: Record<string, string>; devDependencies: Record<string, string> } {
  const scripts: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};

  if (runner === "vitest") {
    scripts["test"] = "vitest run";
    devDependencies["vitest"] = "^3.0.0";
  } else {
    scripts["test"] = "jest";
    devDependencies["jest"] = "^29.0.0";
    devDependencies["ts-jest"] = "^29.0.0";
    devDependencies["@types/jest"] = "^29.0.0";
  }

  const fw = report.framework.appFramework;

  // React frameworks need testing-library
  if (fw === "nextjs-app" || fw === "nextjs-pages" || fw === "react-vite") {
    devDependencies["@testing-library/react"] = "^16.0.0";
    devDependencies["@testing-library/user-event"] = "^14.0.0";
    if (runner === "vitest") {
      devDependencies["jsdom"] = "^25.0.0";
    }
  }

  // Express needs supertest
  if (fw === "express") {
    devDependencies["supertest"] = "^7.0.0";
    devDependencies["@types/supertest"] = "^6.0.0";
  }

  return { scripts, devDependencies };
}

// ---------------------------------------------------------------------------
// Unit Test Stub Generation
// ---------------------------------------------------------------------------

function deriveTestFilePath(
  sourcePath: string,
  testDir: string,
): string {
  // Strip leading source directory prefix to get the relative sub-path
  const srcPrefixes = ["src/", "lib/", "app/", "pages/"];
  let subPath = sourcePath.replace(/\\/g, "/");
  for (const prefix of srcPrefixes) {
    if (subPath.startsWith(prefix)) {
      subPath = subPath.slice(prefix.length);
      break;
    }
  }

  const dir = dirname(subPath);
  const base = basename(subPath);
  const ext = extname(base);
  const nameWithoutExt = base.replace(/\.(ts|tsx|js|jsx)$/, "");
  const testExt = ext === ".tsx" || ext === ".jsx" ? ext : ".ts";
  const dirPart = dir === "." ? "" : `${dir}/`;

  return `${testDir}/${dirPart}${nameWithoutExt}.test${testExt}`;
}

function buildUnitTestStubs(
  report: TestAnalysisReport,
  testDir: string,
  categoryFilter?: string[],
): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const appFramework = report.framework.appFramework;

  for (const category of report.categories) {
    // If a category filter is provided, skip categories not in the list
    if (categoryFilter && categoryFilter.length > 0) {
      if (!categoryFilter.includes(category.name)) {
        continue;
      }
    }

    for (const untestedFile of category.untestedFiles) {
      const testPath = deriveTestFilePath(untestedFile, testDir);
      const content = generateTestTemplate(untestedFile, category.name, appFramework);
      results.push({ path: testPath, content });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function buildScaffoldPlan(
  report: TestAnalysisReport,
  options: ScaffoldOptions,
): Promise<ScaffoldPlan> {
  const testDir = options.testDir ?? "tests";
  const runner = options.runner ?? "vitest";
  const structural = options.structural ?? true;

  // Config file
  let configFile: ScaffoldPlan["configFile"] = null;
  if (runner === "vitest") {
    configFile = {
      path: "vitest.config.ts",
      content: generateVitestConfig(report, testDir),
    };
  } else {
    configFile = {
      path: "jest.config.ts",
      content: generateJestConfig(report, testDir),
    };
  }

  // Package.json updates
  const packageJsonUpdates = buildPackageJsonUpdates(runner, report);

  // Unit test stubs
  const testFiles = buildUnitTestStubs(report, testDir, options.categories);

  // Structural tests
  let structuralTests: Array<{ path: string; content: string }> = [];
  if (structural) {
    const sourceDir = report.categories.length > 0
      ? guessSourceDir(report)
      : "src";

    structuralTests = generateStructuralTests({
      sourceDir,
      testDir,
      entryPoints: options.entryPoints,
    });
  }

  return {
    configFile,
    packageJsonUpdates,
    testFiles,
    structuralTests,
  };
}

/** Infer the source directory from the report's source file paths. */
function guessSourceDir(report: TestAnalysisReport): string {
  for (const cat of report.categories) {
    for (const f of cat.sourceFiles) {
      const normalized = f.replace(/\\/g, "/");
      if (normalized.startsWith("src/")) return "src";
      if (normalized.startsWith("lib/")) return "lib";
      if (normalized.startsWith("app/")) return "app";
    }
  }
  return "src";
}

export async function executeScaffoldPlan(
  plan: ScaffoldPlan,
  projectDir: string,
): Promise<{ filesWritten: string[] }> {
  const filesWritten: string[] = [];

  // Write config file
  if (plan.configFile) {
    const fullPath = `${projectDir}/${plan.configFile.path}`;
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, plan.configFile.content, "utf-8");
    filesWritten.push(plan.configFile.path);
  }

  // Write unit test stubs
  for (const file of plan.testFiles) {
    const fullPath = `${projectDir}/${file.path}`;
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.content, "utf-8");
    filesWritten.push(file.path);
  }

  // Write structural tests
  for (const file of plan.structuralTests) {
    const fullPath = `${projectDir}/${file.path}`;
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.content, "utf-8");
    filesWritten.push(file.path);
  }

  return { filesWritten };
}
