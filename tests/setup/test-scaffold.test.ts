import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, writeFile } from "node:fs/promises";
import {
  buildScaffoldPlan,
  executeScaffoldPlan,
  type ScaffoldPlan,
  type ScaffoldOptions,
} from "../../src/setup/test-scaffold.js";
import {
  generateTestTemplate,
  computeRelativeImport,
  nextjsApiRouteTemplate,
  reactComponentTemplate,
  utilityTemplate,
  expressRouteTemplate,
} from "../../src/setup/test-templates.js";
import {
  generateStructuralTests,
  type StructuralTestOptions,
} from "../../src/setup/structural-templates.js";
import type { TestAnalysisReport, TestCategory } from "../../src/gates/test-analysis.js";

// ---------------------------------------------------------------------------
// Helpers: build TestAnalysisReport fixtures
// ---------------------------------------------------------------------------

function makeReport(overrides: {
  testRunner?: "vitest" | "jest" | "none";
  appFramework?: TestAnalysisReport["framework"]["appFramework"];
  categories?: TestCategory[];
  untestedFiles?: string[];
}): TestAnalysisReport {
  const categories = overrides.categories ?? [];
  const allUntested = overrides.untestedFiles ??
    categories.flatMap((c) => c.untestedFiles);

  return {
    framework: {
      testRunner: overrides.testRunner ?? "vitest",
      appFramework: overrides.appFramework ?? "plain-ts",
      detectedPatterns: [],
    },
    coverage: {
      sourceFiles: categories.reduce((n, c) => n + c.sourceFiles.length, 0),
      testFiles: categories.reduce((n, c) => n + c.testFiles.length, 0),
      ratio: 0,
      untestedFiles: allUntested,
    },
    categories,
  };
}

function makeCategory(
  name: string,
  sourceFiles: string[],
  untestedFiles: string[],
  testFiles: string[] = [],
): TestCategory {
  return { name, sourceFiles, testFiles, untestedFiles };
}

const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);

// ===========================================================================
// 1. buildScaffoldPlan tests
// ===========================================================================

describe("buildScaffoldPlan", () => {
  // -----------------------------------------------------------------------
  // Config file generation
  // -----------------------------------------------------------------------

  describe("config file generation", () => {
    it("generates vitest.config.ts when runner is vitest", async () => {
      const report = makeReport({ testRunner: "vitest" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.configFile).not.toBeNull();
      expect(plan.configFile!.path).toBe("vitest.config.ts");
      expect(plan.configFile!.content).toContain("include:");
      expect(plan.configFile!.content).toContain("coverage");
      expect(plan.configFile!.content).toContain('provider: "v8"');
    });

    it("generates jest.config.ts when runner is jest", async () => {
      const report = makeReport({ testRunner: "jest" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "jest",
      });

      expect(plan.configFile).not.toBeNull();
      expect(plan.configFile!.path).toBe("jest.config.ts");
      expect(plan.configFile!.content).toContain("testMatch");
      expect(plan.configFile!.content).toContain("ts-jest");
    });

    it("defaults to vitest when runner is not specified", async () => {
      const report = makeReport({});
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.configFile!.path).toBe("vitest.config.ts");
    });

    it("includes jsdom environment for nextjs-app framework (vitest)", async () => {
      const report = makeReport({ appFramework: "nextjs-app" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.configFile!.content).toContain('environment: "jsdom"');
    });

    it("includes jsdom environment for react-vite framework (vitest)", async () => {
      const report = makeReport({ appFramework: "react-vite" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.configFile!.content).toContain('environment: "jsdom"');
    });

    it("includes testEnvironment jsdom for nextjs-app framework (jest)", async () => {
      const report = makeReport({ appFramework: "nextjs-app" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "jest",
      });

      expect(plan.configFile!.content).toContain('testEnvironment: "jsdom"');
    });

    it("includes testEnvironment jsdom for react-vite framework (jest)", async () => {
      const report = makeReport({ appFramework: "react-vite" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "jest",
      });

      expect(plan.configFile!.content).toContain('testEnvironment: "jsdom"');
    });

    it("does not include jsdom for plain-ts framework", async () => {
      const report = makeReport({ appFramework: "plain-ts" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.configFile!.content).not.toContain("jsdom");
    });

    it("does not include jsdom for express framework", async () => {
      const report = makeReport({ appFramework: "express" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.configFile!.content).not.toContain("jsdom");
    });

    it("uses custom testDir in vitest config include paths", async () => {
      const report = makeReport({});
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        testDir: "spec",
      });

      expect(plan.configFile!.content).toContain("spec/**/*.test.ts");
    });

    it("uses custom testDir in jest config testMatch paths", async () => {
      const report = makeReport({});
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "jest",
        testDir: "spec",
      });

      expect(plan.configFile!.content).toContain("spec/**/*.test.ts");
    });
  });

  // -----------------------------------------------------------------------
  // Package.json updates
  // -----------------------------------------------------------------------

  describe("package.json updates", () => {
    it("sets test script to 'vitest run' for vitest runner", async () => {
      const report = makeReport({});
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.packageJsonUpdates.scripts?.test).toBe("vitest run");
    });

    it("includes vitest in devDependencies for vitest runner", async () => {
      const report = makeReport({});
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.packageJsonUpdates.devDependencies?.vitest).toBeDefined();
    });

    it("sets test script to 'jest' for jest runner", async () => {
      const report = makeReport({});
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "jest",
      });

      expect(plan.packageJsonUpdates.scripts?.test).toBe("jest");
    });

    it("includes jest, ts-jest, and @types/jest for jest runner", async () => {
      const report = makeReport({});
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "jest",
      });

      const devDeps = plan.packageJsonUpdates.devDependencies!;
      expect(devDeps.jest).toBeDefined();
      expect(devDeps["ts-jest"]).toBeDefined();
      expect(devDeps["@types/jest"]).toBeDefined();
    });

    it("includes @testing-library/react for nextjs-app framework", async () => {
      const report = makeReport({ appFramework: "nextjs-app" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      const devDeps = plan.packageJsonUpdates.devDependencies!;
      expect(devDeps["@testing-library/react"]).toBeDefined();
      expect(devDeps["@testing-library/user-event"]).toBeDefined();
    });

    it("includes @testing-library/react for react-vite framework", async () => {
      const report = makeReport({ appFramework: "react-vite" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      const devDeps = plan.packageJsonUpdates.devDependencies!;
      expect(devDeps["@testing-library/react"]).toBeDefined();
      expect(devDeps["@testing-library/user-event"]).toBeDefined();
    });

    it("includes jsdom devDep for react frameworks with vitest", async () => {
      const report = makeReport({ appFramework: "nextjs-app" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "vitest",
      });

      expect(plan.packageJsonUpdates.devDependencies!.jsdom).toBeDefined();
    });

    it("does not include jsdom devDep for react frameworks with jest", async () => {
      const report = makeReport({ appFramework: "nextjs-app" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        runner: "jest",
      });

      expect(plan.packageJsonUpdates.devDependencies!.jsdom).toBeUndefined();
    });

    it("includes supertest for express framework", async () => {
      const report = makeReport({ appFramework: "express" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      const devDeps = plan.packageJsonUpdates.devDependencies!;
      expect(devDeps.supertest).toBeDefined();
      expect(devDeps["@types/supertest"]).toBeDefined();
    });

    it("does not include supertest for plain-ts framework", async () => {
      const report = makeReport({ appFramework: "plain-ts" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.packageJsonUpdates.devDependencies!.supertest).toBeUndefined();
    });

    it("does not include testing-library for plain-ts framework", async () => {
      const report = makeReport({ appFramework: "plain-ts" });
      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(
        plan.packageJsonUpdates.devDependencies!["@testing-library/react"],
      ).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Unit test stub generation
  // -----------------------------------------------------------------------

  describe("unit test stubs", () => {
    it("generates test stubs for untested files", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/helpers.ts"], ["src/utils/helpers.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles.length).toBe(1);
      expect(plan.testFiles[0].path).toContain("helpers.test.ts");
      expect(plan.testFiles[0].content).toBeTruthy();
    });

    it("derives test path: src/utils/helpers.ts -> tests/utils/helpers.test.ts", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/helpers.ts"], ["src/utils/helpers.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles[0].path).toBe("tests/utils/helpers.test.ts");
    });

    it("derives test path stripping src/ prefix", async () => {
      const report = makeReport({
        categories: [
          makeCategory("other", ["src/config.ts"], ["src/config.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles[0].path).toBe("tests/config.test.ts");
    });

    it("derives test path stripping lib/ prefix", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["lib/utils/helpers.ts"], ["lib/utils/helpers.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles[0].path).toBe("tests/utils/helpers.test.ts");
    });

    it("uses custom testDir for generated test paths", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/helpers.ts"], ["src/utils/helpers.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        testDir: "spec",
      });

      expect(plan.testFiles[0].path).toBe("spec/utils/helpers.test.ts");
    });

    it("generates stubs for multiple untested files across categories", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts", "src/utils/b.ts"], ["src/utils/a.ts", "src/utils/b.ts"]),
          makeCategory("other", ["src/config.ts"], ["src/config.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles.length).toBe(3);
    });

    it("only generates stubs for untested files, not tested ones", async () => {
      const report = makeReport({
        categories: [
          makeCategory(
            "utils",
            ["src/utils/a.ts", "src/utils/b.ts"],
            ["src/utils/b.ts"],
            ["tests/utils/a.test.ts"],
          ),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles.length).toBe(1);
      expect(plan.testFiles[0].path).toBe("tests/utils/b.test.ts");
    });

    it("filters categories when categories option is provided", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], ["src/utils/a.ts"]),
          makeCategory("api-routes", ["src/api/users.ts"], ["src/api/users.ts"]),
          makeCategory("other", ["src/config.ts"], ["src/config.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        categories: ["utils"],
      });

      expect(plan.testFiles.length).toBe(1);
      expect(plan.testFiles[0].path).toContain("utils/a.test.ts");
    });

    it("filters to multiple categories", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], ["src/utils/a.ts"]),
          makeCategory("api-routes", ["src/api/users.ts"], ["src/api/users.ts"]),
          makeCategory("other", ["src/config.ts"], ["src/config.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        categories: ["utils", "api-routes"],
      });

      expect(plan.testFiles.length).toBe(2);
    });

    it("returns empty testFiles when report has no categories", async () => {
      const report = makeReport({ categories: [] });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles).toEqual([]);
    });

    it("returns empty testFiles when no untested files exist", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/a.ts"], [], ["tests/a.test.ts"]),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.testFiles).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Structural tests
  // -----------------------------------------------------------------------

  describe("structural tests", () => {
    it("includes structural tests by default", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], []),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      expect(plan.structuralTests.length).toBeGreaterThan(0);
    });

    it("excludes structural tests when structural=false", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], []),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        structural: false,
      });

      expect(plan.structuralTests).toEqual([]);
    });

    it("structural test paths are under testDir/structural/", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], []),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      for (const st of plan.structuralTests) {
        expect(st.path).toMatch(/^tests\/structural\//);
      }
    });

    it("uses custom testDir for structural test paths", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], []),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        testDir: "spec",
      });

      for (const st of plan.structuralTests) {
        expect(st.path).toMatch(/^spec\/structural\//);
      }
    });

    it("includes export boundary test when entryPoints provided", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], []),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        entryPoints: ["index.ts"],
      });

      const hasExportBoundary = plan.structuralTests.some(
        (st) => st.path.includes("export-boundaries"),
      );
      expect(hasExportBoundary).toBe(true);
    });

    it("does not include export boundary test when no entryPoints", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], []),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      const hasExportBoundary = plan.structuralTests.some(
        (st) => st.path.includes("export-boundaries"),
      );
      expect(hasExportBoundary).toBe(false);
    });

    it("guesses sourceDir from category source files", async () => {
      const report = makeReport({
        categories: [
          makeCategory("utils", ["src/utils/a.ts"], []),
        ],
      });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
      });

      // The circular import template should reference "src" as the source dir
      const circularTest = plan.structuralTests.find(
        (st) => st.path.includes("no-circular-imports"),
      );
      expect(circularTest).toBeDefined();
      expect(circularTest!.content).toContain('"src"');
    });

    it("defaults sourceDir to 'src' when no categories", async () => {
      const report = makeReport({ categories: [] });

      const plan = await buildScaffoldPlan(report, {
        projectDir: "/project",
        structural: true,
      });

      // Even with no categories, structural tests should be generated
      expect(plan.structuralTests.length).toBeGreaterThan(0);
      const circularTest = plan.structuralTests.find(
        (st) => st.path.includes("no-circular-imports"),
      );
      expect(circularTest!.content).toContain('"src"');
    });
  });
});

// ===========================================================================
// 2. generateTestTemplate tests
// ===========================================================================

describe("generateTestTemplate", () => {
  it("generates Next.js API route template for api-routes + nextjs-app", () => {
    const content = generateTestTemplate(
      "src/api/users.ts",
      "api-routes",
      "nextjs-app",
    );

    expect(content).toContain("NextRequest");
    expect(content).toContain("GET");
    expect(content).toContain("POST");
    expect(content).toContain("vitest");
  });

  it("generates Next.js API route template for api-routes + nextjs-pages", () => {
    const content = generateTestTemplate(
      "src/api/users.ts",
      "api-routes",
      "nextjs-pages",
    );

    expect(content).toContain("NextRequest");
  });

  it("generates Express route template for api-routes + express", () => {
    const content = generateTestTemplate(
      "src/routes/users.ts",
      "api-routes",
      "express",
    );

    expect(content).toContain("supertest");
    expect(content).toContain("express");
    expect(content).toContain("router");
  });

  it("falls back to utility template for api-routes + unknown framework", () => {
    const content = generateTestTemplate(
      "src/api/users.ts",
      "api-routes",
      "plain-ts",
    );

    // Should be utility template (no supertest, no NextRequest)
    expect(content).not.toContain("supertest");
    expect(content).not.toContain("NextRequest");
    expect(content).toContain("describe");
    expect(content).toContain("expect");
  });

  it("generates React component template for components + react-vite", () => {
    const content = generateTestTemplate(
      "src/components/Button.tsx",
      "components",
      "react-vite",
    );

    expect(content).toContain("@testing-library/react");
    expect(content).toContain("render");
    expect(content).toContain("screen");
    expect(content).toContain("userEvent");
  });

  it("generates React component template for components + nextjs-app", () => {
    const content = generateTestTemplate(
      "src/components/Header.tsx",
      "components",
      "nextjs-app",
    );

    expect(content).toContain("@testing-library/react");
  });

  it("falls back to utility template for components + plain-ts", () => {
    const content = generateTestTemplate(
      "src/components/widget.ts",
      "components",
      "plain-ts",
    );

    expect(content).not.toContain("@testing-library/react");
    expect(content).toContain("describe");
  });

  it("generates utility template for utils category", () => {
    const content = generateTestTemplate(
      "src/utils/helpers.ts",
      "utils",
      "plain-ts",
    );

    expect(content).toContain("describe");
    expect(content).toContain("it");
    expect(content).toContain("expect");
    expect(content).not.toContain("supertest");
    expect(content).not.toContain("NextRequest");
    expect(content).not.toContain("@testing-library/react");
  });

  it("generates utility template for unknown category", () => {
    const content = generateTestTemplate(
      "src/other/thing.ts",
      "other",
      "plain-ts",
    );

    // Falls back to utility template
    expect(content).toContain("describe");
    expect(content).toContain("expect");
  });

  it("generates express template for middleware + express", () => {
    const content = generateTestTemplate(
      "src/middleware/auth.ts",
      "middleware",
      "express",
    );

    expect(content).toContain("supertest");
    expect(content).toContain("express");
  });

  it("falls back to utility template for middleware + non-express", () => {
    const content = generateTestTemplate(
      "src/middleware/auth.ts",
      "middleware",
      "plain-ts",
    );

    expect(content).not.toContain("supertest");
    expect(content).toContain("describe");
  });
});

// ===========================================================================
// 3. Individual template function tests
// ===========================================================================

describe("nextjsApiRouteTemplate", () => {
  it("includes NextRequest import", () => {
    const content = nextjsApiRouteTemplate("src/api/users.ts");
    expect(content).toContain('import { NextRequest } from "next/server"');
  });

  it("includes GET and POST imports", () => {
    const content = nextjsApiRouteTemplate("src/api/users.ts");
    expect(content).toContain("GET");
    expect(content).toContain("POST");
  });

  it("derives module name from file path", () => {
    const content = nextjsApiRouteTemplate("src/api/user-profile.ts");
    expect(content).toContain("userProfile");
  });
});

describe("reactComponentTemplate", () => {
  it("includes testing-library imports", () => {
    const content = reactComponentTemplate("src/components/Button.tsx");
    expect(content).toContain("@testing-library/react");
    expect(content).toContain("@testing-library/user-event");
  });

  it("capitalizes component name", () => {
    const content = reactComponentTemplate("src/components/button.tsx");
    expect(content).toContain("Button");
  });

  it("includes render and screen", () => {
    const content = reactComponentTemplate("src/components/Card.tsx");
    expect(content).toContain("render");
    expect(content).toContain("screen");
  });
});

describe("utilityTemplate", () => {
  it("includes describe/it/expect", () => {
    const content = utilityTemplate("src/utils/helpers.ts");
    expect(content).toContain("describe");
    expect(content).toContain("it");
    expect(content).toContain("expect");
  });

  it("uses module name from file", () => {
    const content = utilityTemplate("src/utils/parse-config.ts");
    expect(content).toContain("parseConfig");
  });

  it("includes edge case section", () => {
    const content = utilityTemplate("src/utils/helpers.ts");
    expect(content).toContain("edge-case input");
  });
});

describe("expressRouteTemplate", () => {
  it("includes supertest import", () => {
    const content = expressRouteTemplate("src/routes/users.ts");
    expect(content).toContain('import request from "supertest"');
  });

  it("includes express import", () => {
    const content = expressRouteTemplate("src/routes/users.ts");
    expect(content).toContain('import express from "express"');
  });

  it("uses module name for route path", () => {
    const content = expressRouteTemplate("src/routes/users.ts");
    expect(content).toContain("GET /users");
    expect(content).toContain("POST /users");
  });
});

describe("computeRelativeImport", () => {
  it("computes relative path between test and source", () => {
    const rel = computeRelativeImport(
      "tests/utils/helpers.test.ts",
      "src/utils/helpers.ts",
    );
    expect(rel).toContain("src/utils/helpers");
    expect(rel).not.toContain(".ts");
  });

  it("starts with ./ or ../", () => {
    const rel = computeRelativeImport(
      "tests/helpers.test.ts",
      "src/helpers.ts",
    );
    expect(rel.startsWith("./") || rel.startsWith("../")).toBe(true);
  });
});

// ===========================================================================
// 4. generateStructuralTests tests
// ===========================================================================

describe("generateStructuralTests", () => {
  it("returns circular import and file naming tests by default", () => {
    const results = generateStructuralTests({
      sourceDir: "src",
      testDir: "tests",
    });

    expect(results.length).toBe(2);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("tests/structural/no-circular-imports.test.ts");
    expect(paths).toContain("tests/structural/file-naming.test.ts");
  });

  it("includes export boundary test when entryPoints are provided", () => {
    const results = generateStructuralTests({
      sourceDir: "src",
      testDir: "tests",
      entryPoints: ["index.ts"],
    });

    expect(results.length).toBe(3);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("tests/structural/export-boundaries.test.ts");
  });

  it("skips export boundary test when entryPoints is empty", () => {
    const results = generateStructuralTests({
      sourceDir: "src",
      testDir: "tests",
      entryPoints: [],
    });

    expect(results.length).toBe(2);
    const paths = results.map((r) => r.path);
    expect(paths).not.toContain("tests/structural/export-boundaries.test.ts");
  });

  it("skips export boundary test when entryPoints is undefined", () => {
    const results = generateStructuralTests({
      sourceDir: "src",
      testDir: "tests",
    });

    const paths = results.map((r) => r.path);
    expect(paths).not.toContain("tests/structural/export-boundaries.test.ts");
  });

  it("paths are under testDir/structural/", () => {
    const results = generateStructuralTests({
      sourceDir: "src",
      testDir: "my-tests",
    });

    for (const r of results) {
      expect(r.path).toMatch(/^my-tests\/structural\//);
    }
  });

  it("circular import template references the sourceDir", () => {
    const results = generateStructuralTests({
      sourceDir: "lib",
      testDir: "tests",
    });

    const circular = results.find((r) =>
      r.path.includes("no-circular-imports"),
    );
    expect(circular!.content).toContain('"lib"');
  });

  it("file naming template references the sourceDir", () => {
    const results = generateStructuralTests({
      sourceDir: "lib",
      testDir: "tests",
    });

    const naming = results.find((r) => r.path.includes("file-naming"));
    expect(naming!.content).toContain('"lib"');
  });

  it("export boundary template includes entry point list", () => {
    const results = generateStructuralTests({
      sourceDir: "src",
      testDir: "tests",
      entryPoints: ["index.ts", "cli.ts"],
    });

    const boundary = results.find((r) =>
      r.path.includes("export-boundaries"),
    );
    expect(boundary!.content).toContain("index.ts");
    expect(boundary!.content).toContain("cli.ts");
  });
});

// ===========================================================================
// 5. executeScaffoldPlan tests
// ===========================================================================

describe("executeScaffoldPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes config file to disk", async () => {
    const plan: ScaffoldPlan = {
      configFile: { path: "vitest.config.ts", content: "// config" },
      packageJsonUpdates: {},
      testFiles: [],
      structuralTests: [],
    };

    await executeScaffoldPlan(plan, "/project");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/vitest.config.ts",
      "// config",
      "utf-8",
    );
  });

  it("creates parent directories for config file", async () => {
    const plan: ScaffoldPlan = {
      configFile: { path: "config/vitest.config.ts", content: "// config" },
      packageJsonUpdates: {},
      testFiles: [],
      structuralTests: [],
    };

    await executeScaffoldPlan(plan, "/project");

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("config"),
      { recursive: true },
    );
  });

  it("writes test files to disk", async () => {
    const plan: ScaffoldPlan = {
      configFile: null,
      packageJsonUpdates: {},
      testFiles: [
        { path: "tests/utils/helpers.test.ts", content: "// test stub" },
      ],
      structuralTests: [],
    };

    await executeScaffoldPlan(plan, "/project");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/tests/utils/helpers.test.ts",
      "// test stub",
      "utf-8",
    );
  });

  it("creates directories recursively for test files", async () => {
    const plan: ScaffoldPlan = {
      configFile: null,
      packageJsonUpdates: {},
      testFiles: [
        { path: "tests/deep/nested/helpers.test.ts", content: "// test" },
      ],
      structuralTests: [],
    };

    await executeScaffoldPlan(plan, "/project");

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("nested"),
      { recursive: true },
    );
  });

  it("writes structural test files to disk", async () => {
    const plan: ScaffoldPlan = {
      configFile: null,
      packageJsonUpdates: {},
      testFiles: [],
      structuralTests: [
        {
          path: "tests/structural/no-circular-imports.test.ts",
          content: "// structural",
        },
      ],
    };

    await executeScaffoldPlan(plan, "/project");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/tests/structural/no-circular-imports.test.ts",
      "// structural",
      "utf-8",
    );
  });

  it("returns list of all written file paths", async () => {
    const plan: ScaffoldPlan = {
      configFile: { path: "vitest.config.ts", content: "// config" },
      packageJsonUpdates: {},
      testFiles: [
        { path: "tests/a.test.ts", content: "// a" },
        { path: "tests/b.test.ts", content: "// b" },
      ],
      structuralTests: [
        { path: "tests/structural/circular.test.ts", content: "// c" },
      ],
    };

    const result = await executeScaffoldPlan(plan, "/project");

    expect(result.filesWritten).toEqual([
      "vitest.config.ts",
      "tests/a.test.ts",
      "tests/b.test.ts",
      "tests/structural/circular.test.ts",
    ]);
  });

  it("returns empty array when plan has no files", async () => {
    const plan: ScaffoldPlan = {
      configFile: null,
      packageJsonUpdates: {},
      testFiles: [],
      structuralTests: [],
    };

    const result = await executeScaffoldPlan(plan, "/project");

    expect(result.filesWritten).toEqual([]);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("does not write config file when configFile is null", async () => {
    const plan: ScaffoldPlan = {
      configFile: null,
      packageJsonUpdates: {},
      testFiles: [{ path: "tests/a.test.ts", content: "// a" }],
      structuralTests: [],
    };

    await executeScaffoldPlan(plan, "/project");

    // mkdir and writeFile should only be called once (for the test file)
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/tests/a.test.ts",
      "// a",
      "utf-8",
    );
  });
});
