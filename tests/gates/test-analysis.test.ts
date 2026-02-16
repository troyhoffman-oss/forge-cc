import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

import { readdir, readFile, stat } from "node:fs/promises";
import { analyzeTestCoverage } from "../../src/gates/test-analysis.js";

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);
const mockStat = vi.mocked(stat);

// ---------------------------------------------------------------------------
// Helpers for building mock filesystem
// ---------------------------------------------------------------------------

function makeDirent(name: string, isDir: boolean): import("node:fs").Dirent {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: "",
    parentPath: "",
  } as import("node:fs").Dirent;
}

/**
 * Configure mockReaddir/mockStat to simulate a virtual file tree.
 * `tree` maps directory absolute paths to arrays of {name, isDir}.
 */
function setupFileSystem(
  tree: Record<string, Array<{ name: string; isDir: boolean }>>,
  files: Record<string, string> = {},
) {
  mockReaddir.mockImplementation(async (dir: any) => {
    const dirStr = String(dir);
    const entries = tree[dirStr.replace(/\\/g, "/")];
    if (!entries) throw new Error(`ENOENT: ${dirStr}`);
    return entries.map((e) => makeDirent(e.name, e.isDir)) as any;
  });

  mockStat.mockImplementation(async (p: any) => {
    const pathStr = String(p).replace(/\\/g, "/");
    // Check if it's a directory in the tree
    if (tree[pathStr]) {
      return { isDirectory: () => true, isFile: () => false } as any;
    }
    // Check if it matches a file in a tree entry
    for (const [dir, entries] of Object.entries(tree)) {
      for (const entry of entries) {
        const fullPath = `${dir}/${entry.name}`;
        if (fullPath === pathStr) {
          return {
            isDirectory: () => entry.isDir,
            isFile: () => !entry.isDir,
          } as any;
        }
      }
    }
    throw new Error(`ENOENT: ${pathStr}`);
  });

  mockReadFile.mockImplementation(async (p: any) => {
    const pathStr = String(p).replace(/\\/g, "/");
    if (files[pathStr] !== undefined) {
      return files[pathStr] as any;
    }
    throw new Error(`ENOENT: ${pathStr}`);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyzeTestCoverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Framework Detection
  // -----------------------------------------------------------------------

  describe("framework detection", () => {
    it("detects vitest as test runner when vitest is in devDependencies", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "index.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.testRunner).toBe("vitest");
      expect(report.framework.detectedPatterns).toContain(
        "vitest in dependencies",
      );
    });

    it("detects jest as test runner when jest is in devDependencies", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { jest: "^29.0.0", typescript: "^5.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "index.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.testRunner).toBe("jest");
      expect(report.framework.detectedPatterns).toContain(
        "jest in dependencies",
      );
    });

    it("returns 'none' when no test runner is detected", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { typescript: "^5.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "index.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.testRunner).toBe("none");
    });

    it("detects nextjs-app framework with next dependency and app/ dir", async () => {
      const pkgJson = JSON.stringify({
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
        devDependencies: {},
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
            { name: "app", isDir: true },
          ],
          "/project/src": [{ name: "lib.ts", isDir: false }],
          "/project/app": [{ name: "page.tsx", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.appFramework).toBe("nextjs-app");
    });

    it("detects nextjs-pages framework with next dependency and pages/ dir", async () => {
      const pkgJson = JSON.stringify({
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
        devDependencies: {},
      });

      // app/ dir does not exist, pages/ does
      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
            { name: "pages", isDir: true },
          ],
          "/project/src": [{ name: "lib.ts", isDir: false }],
          "/project/pages": [{ name: "index.tsx", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.appFramework).toBe("nextjs-pages");
    });

    it("detects react-vite framework with react + vite deps", async () => {
      const pkgJson = JSON.stringify({
        dependencies: { react: "^18.0.0", vite: "^5.0.0" },
        devDependencies: {},
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "App.tsx", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.appFramework).toBe("react-vite");
    });

    it("detects express framework", async () => {
      const pkgJson = JSON.stringify({
        dependencies: { express: "^4.0.0" },
        devDependencies: {},
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "server.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.appFramework).toBe("express");
    });

    it("detects plain-ts framework when tsconfig.json exists", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { typescript: "^5.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "tsconfig.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "index.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.appFramework).toBe("plain-ts");
    });

    it("returns 'unknown' when no framework detected", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: {},
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "index.js", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.appFramework).toBe("unknown");
    });
  });

  // -----------------------------------------------------------------------
  // Source-to-Test Mapping and Coverage
  // -----------------------------------------------------------------------

  describe("coverage calculation", () => {
    it("counts source files and test files correctly", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
            { name: "tests", isDir: true },
          ],
          "/project/src": [
            { name: "foo.ts", isDir: false },
            { name: "bar.ts", isDir: false },
            { name: "baz.ts", isDir: false },
          ],
          "/project/tests": [
            { name: "foo.test.ts", isDir: false },
            { name: "bar.test.ts", isDir: false },
          ],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.coverage.sourceFiles).toBe(3);
      expect(report.coverage.testFiles).toBe(2);
    });

    it("calculates coverage ratio correctly", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
            { name: "tests", isDir: true },
          ],
          "/project/src": [
            { name: "a.ts", isDir: false },
            { name: "b.ts", isDir: false },
            { name: "c.ts", isDir: false },
            { name: "d.ts", isDir: false },
          ],
          "/project/tests": [
            { name: "a.test.ts", isDir: false },
            { name: "b.test.ts", isDir: false },
          ],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      // 2 test files / 4 source files = 0.5
      expect(report.coverage.ratio).toBe(0.5);
    });

    it("identifies untested files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
            { name: "tests", isDir: true },
          ],
          "/project/src": [
            { name: "foo.ts", isDir: false },
            { name: "bar.ts", isDir: false },
          ],
          "/project/tests": [{ name: "foo.test.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.coverage.untestedFiles).toContain("src/bar.ts");
      expect(report.coverage.untestedFiles).not.toContain("src/foo.ts");
    });

    it("handles empty project with no source files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: {},
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.coverage.sourceFiles).toBe(0);
      expect(report.coverage.testFiles).toBe(0);
      expect(report.coverage.ratio).toBe(0);
      expect(report.coverage.untestedFiles).toEqual([]);
    });

    it("handles project with no package.json", async () => {
      setupFileSystem(
        {
          "/project": [{ name: "src", isDir: true }],
          "/project/src": [{ name: "index.ts", isDir: false }],
        },
        {},
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.framework.testRunner).toBe("none");
      expect(report.coverage.sourceFiles).toBe(1);
      expect(report.coverage.testFiles).toBe(0);
    });

    it("excludes .d.ts files from source files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [
            { name: "index.ts", isDir: false },
            { name: "types.d.ts", isDir: false },
          ],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.coverage.sourceFiles).toBe(1);
    });

    it("maps co-located test files to source files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [
            { name: "utils.ts", isDir: false },
            { name: "utils.test.ts", isDir: false },
          ],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.coverage.sourceFiles).toBe(1);
      expect(report.coverage.testFiles).toBe(1);
      // utils.ts should be covered by co-located utils.test.ts
      expect(report.coverage.untestedFiles).not.toContain("src/utils.ts");
    });

    it("maps spec-named test files to source files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [
            { name: "utils.ts", isDir: false },
            { name: "utils.spec.ts", isDir: false },
          ],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      expect(report.coverage.untestedFiles).not.toContain("src/utils.ts");
    });
  });

  // -----------------------------------------------------------------------
  // Categorization
  // -----------------------------------------------------------------------

  describe("file categorization", () => {
    it("categorizes API route files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "api", isDir: true }],
          "/project/src/api": [{ name: "users.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      const apiCategory = report.categories.find(
        (c) => c.name === "api-routes",
      );
      expect(apiCategory).toBeDefined();
      expect(apiCategory!.sourceFiles).toContain("src/api/users.ts");
    });

    it("categorizes component files (tsx)", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "Button.tsx", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      const compCategory = report.categories.find(
        (c) => c.name === "components",
      );
      expect(compCategory).toBeDefined();
      expect(compCategory!.sourceFiles).toContain("src/Button.tsx");
    });

    it("categorizes utils files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "utils", isDir: true }],
          "/project/src/utils": [{ name: "helpers.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      const utilsCategory = report.categories.find(
        (c) => c.name === "utils",
      );
      expect(utilsCategory).toBeDefined();
      expect(utilsCategory!.sourceFiles).toContain("src/utils/helpers.ts");
    });

    it("categorizes middleware files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "middleware.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      const mwCategory = report.categories.find(
        (c) => c.name === "middleware",
      );
      expect(mwCategory).toBeDefined();
      expect(mwCategory!.sourceFiles).toContain("src/middleware.ts");
    });

    it("categorizes model files", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "models", isDir: true }],
          "/project/src/models": [{ name: "user.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      const modelsCategory = report.categories.find(
        (c) => c.name === "models",
      );
      expect(modelsCategory).toBeDefined();
      expect(modelsCategory!.sourceFiles).toContain("src/models/user.ts");
    });

    it("categorizes remaining files as 'other'", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
          ],
          "/project/src": [{ name: "config.ts", isDir: false }],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      const otherCategory = report.categories.find(
        (c) => c.name === "other",
      );
      expect(otherCategory).toBeDefined();
      expect(otherCategory!.sourceFiles).toContain("src/config.ts");
    });

    it("tracks untested files per category", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
            { name: "tests", isDir: true },
          ],
          "/project/src": [{ name: "utils", isDir: true }],
          "/project/src/utils": [
            { name: "a.ts", isDir: false },
            { name: "b.ts", isDir: false },
          ],
          "/project/tests": [
            { name: "utils", isDir: true },
          ],
          "/project/tests/utils": [
            { name: "a.test.ts", isDir: false },
          ],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      const utilsCategory = report.categories.find(
        (c) => c.name === "utils",
      );
      expect(utilsCategory).toBeDefined();
      expect(utilsCategory!.untestedFiles).toContain("src/utils/b.ts");
      expect(utilsCategory!.untestedFiles).not.toContain("src/utils/a.ts");
    });
  });

  // -----------------------------------------------------------------------
  // Skipped Directories
  // -----------------------------------------------------------------------

  describe("directory exclusions", () => {
    it("skips node_modules directory", async () => {
      const pkgJson = JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      });

      setupFileSystem(
        {
          "/project": [
            { name: "package.json", isDir: false },
            { name: "src", isDir: true },
            { name: "node_modules", isDir: true },
          ],
          "/project/src": [{ name: "index.ts", isDir: false }],
          "/project/node_modules": [
            { name: "some-pkg", isDir: true },
          ],
          "/project/node_modules/some-pkg": [
            { name: "index.ts", isDir: false },
          ],
        },
        { "/project/package.json": pkgJson },
      );

      const report = await analyzeTestCoverage("/project");

      // Only src/index.ts should be counted
      expect(report.coverage.sourceFiles).toBe(1);
    });
  });
});
