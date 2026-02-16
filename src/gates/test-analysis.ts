import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename, dirname, extname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestAnalysisReport {
  framework: {
    testRunner: "vitest" | "jest" | "none";
    appFramework:
      | "nextjs-app"
      | "nextjs-pages"
      | "react-vite"
      | "express"
      | "plain-ts"
      | "unknown";
    detectedPatterns: string[];
  };
  coverage: {
    sourceFiles: number;
    testFiles: number;
    ratio: number;
    untestedFiles: string[];
  };
  categories: TestCategory[];
}

export interface TestCategory {
  name: string;
  sourceFiles: string[];
  testFiles: string[];
  untestedFiles: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect files under a directory. */
async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip common non-source directories
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git" ||
        entry.name === ".next" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      results.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/** Check whether a file path is a test file. */
function isTestFile(filePath: string): boolean {
  const base = basename(filePath);
  return (
    base.endsWith(".test.ts") ||
    base.endsWith(".test.tsx") ||
    base.endsWith(".spec.ts") ||
    base.endsWith(".spec.tsx") ||
    base.endsWith(".test.js") ||
    base.endsWith(".test.jsx") ||
    base.endsWith(".spec.js") ||
    base.endsWith(".spec.jsx")
  );
}

/** Check whether a file is a TypeScript/JavaScript source file (not a test, not a declaration). */
function isSourceFile(filePath: string): boolean {
  const base = basename(filePath);
  const ext = extname(filePath);
  if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) return false;
  if (isTestFile(filePath)) return false;
  if (base.endsWith(".d.ts")) return false;
  return true;
}

/** Check whether a directory exists. */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** Check whether a file exists. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/** Read and parse package.json, returning null on failure. */
async function readPackageJson(
  projectDir: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(projectDir, "package.json"), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Framework Detection
// ---------------------------------------------------------------------------

type TestRunner = "vitest" | "jest" | "none";
type AppFramework =
  | "nextjs-app"
  | "nextjs-pages"
  | "react-vite"
  | "express"
  | "plain-ts"
  | "unknown";

async function detectTestRunner(
  projectDir: string,
  pkg: Record<string, unknown> | null,
): Promise<{ runner: TestRunner; patterns: string[] }> {
  const patterns: string[] = [];
  const deps = (pkg?.devDependencies ?? {}) as Record<string, string>;
  const allDeps = {
    ...((pkg?.dependencies ?? {}) as Record<string, string>),
    ...deps,
  };

  // Check for vitest
  if ("vitest" in allDeps) {
    patterns.push("vitest in dependencies");
  }
  if (await fileExists(join(projectDir, "vitest.config.ts"))) {
    patterns.push("vitest.config.ts found");
  }
  if (await fileExists(join(projectDir, "vitest.config.js"))) {
    patterns.push("vitest.config.js found");
  }

  // Check for jest
  if ("jest" in allDeps) {
    patterns.push("jest in dependencies");
  }
  if ("ts-jest" in allDeps) {
    patterns.push("ts-jest in dependencies");
  }
  if (await fileExists(join(projectDir, "jest.config.ts"))) {
    patterns.push("jest.config.ts found");
  }
  if (await fileExists(join(projectDir, "jest.config.js"))) {
    patterns.push("jest.config.js found");
  }

  // Check for testing-library
  for (const dep of Object.keys(allDeps)) {
    if (dep.startsWith("@testing-library/")) {
      patterns.push(`${dep} in devDeps`);
      break;
    }
  }

  // Determine runner
  const hasVitest =
    patterns.some((p) => p.includes("vitest"));
  const hasJest =
    patterns.some((p) => p.includes("jest"));

  let runner: TestRunner = "none";
  if (hasVitest) runner = "vitest";
  else if (hasJest) runner = "jest";

  return { runner, patterns };
}

async function detectAppFramework(
  projectDir: string,
  pkg: Record<string, unknown> | null,
): Promise<{ framework: AppFramework; patterns: string[] }> {
  const patterns: string[] = [];
  const deps = {
    ...((pkg?.dependencies ?? {}) as Record<string, string>),
    ...((pkg?.devDependencies ?? {}) as Record<string, string>),
  };

  const hasNext = "next" in deps;
  const hasReact = "react" in deps;
  const hasExpress = "express" in deps;
  const hasVite = "vite" in deps;

  if (hasNext) {
    patterns.push("next in dependencies");
    // Detect App Router vs Pages Router
    const hasAppDir = await dirExists(join(projectDir, "app")) ||
      await dirExists(join(projectDir, "src", "app"));
    const hasPagesDir = await dirExists(join(projectDir, "pages")) ||
      await dirExists(join(projectDir, "src", "pages"));

    if (hasAppDir) {
      patterns.push("app/ directory found (App Router)");
      return { framework: "nextjs-app", patterns };
    }
    if (hasPagesDir) {
      patterns.push("pages/ directory found (Pages Router)");
      return { framework: "nextjs-pages", patterns };
    }
    // Next.js detected but neither router pattern found — default to app
    return { framework: "nextjs-app", patterns };
  }

  if (hasReact && hasVite) {
    patterns.push("react + vite in dependencies");
    return { framework: "react-vite", patterns };
  }

  if (hasExpress) {
    patterns.push("express in dependencies");
    return { framework: "express", patterns };
  }

  // Check for TypeScript project
  if (
    await fileExists(join(projectDir, "tsconfig.json"))
  ) {
    patterns.push("tsconfig.json found");
    return { framework: "plain-ts", patterns };
  }

  return { framework: "unknown", patterns };
}

// ---------------------------------------------------------------------------
// File Discovery
// ---------------------------------------------------------------------------

/** Locate test directories and co-located test files. */
async function discoverTestFiles(projectDir: string): Promise<string[]> {
  const testFiles: string[] = [];
  const allFiles = await collectFiles(projectDir);
  for (const f of allFiles) {
    if (isTestFile(f)) {
      testFiles.push(relative(projectDir, f));
    }
  }
  return testFiles;
}

/** Locate source files, using sourceDir as the primary search root. */
async function discoverSourceFiles(
  projectDir: string,
  sourceDir: string,
): Promise<string[]> {
  const sourceFiles: string[] = [];

  // Scan the source directory
  const srcPath = join(projectDir, sourceDir);
  if (await dirExists(srcPath)) {
    const allFiles = await collectFiles(srcPath);
    for (const f of allFiles) {
      if (isSourceFile(f)) {
        sourceFiles.push(relative(projectDir, f));
      }
    }
  }

  // Also scan app/ and pages/ for Next.js projects
  for (const extra of ["app", "pages"]) {
    const extraPath = join(projectDir, extra);
    if (await dirExists(extraPath)) {
      const allFiles = await collectFiles(extraPath);
      for (const f of allFiles) {
        if (isSourceFile(f)) {
          const rel = relative(projectDir, f);
          if (!sourceFiles.includes(rel)) {
            sourceFiles.push(rel);
          }
        }
      }
    }
  }

  return sourceFiles;
}

// ---------------------------------------------------------------------------
// Source-to-Test Mapping
// ---------------------------------------------------------------------------

/**
 * Build a mapping from source file to its corresponding test file (if any).
 * Tries several naming conventions:
 *   - Co-located: src/foo/bar.ts -> src/foo/bar.test.ts
 *   - Mirrored:   src/foo/bar.ts -> tests/foo/bar.test.ts
 *   - __tests__:  src/foo/bar.ts -> src/foo/__tests__/bar.test.ts
 */
function mapSourceToTests(
  sourceFiles: string[],
  testFiles: string[],
): Map<string, string | null> {
  const testSet = new Set(testFiles.map((t) => t.replace(/\\/g, "/")));
  const mapping = new Map<string, string | null>();

  for (const src of sourceFiles) {
    const normalized = src.replace(/\\/g, "/");
    const dir = dirname(normalized);
    const base = basename(normalized);
    const nameWithoutExt = base.replace(/\.(ts|tsx|js|jsx)$/, "");
    const ext = extname(base);
    const testExt = ext === ".tsx" || ext === ".jsx" ? ext : ".ts";

    // Candidate patterns
    const candidates = [
      // Co-located: same directory
      `${dir}/${nameWithoutExt}.test${testExt}`,
      `${dir}/${nameWithoutExt}.spec${testExt}`,
      // __tests__ subdirectory
      `${dir}/__tests__/${nameWithoutExt}.test${testExt}`,
      `${dir}/__tests__/${nameWithoutExt}.spec${testExt}`,
    ];

    // Mirrored directory: replace leading source dir with common test dirs
    const srcPrefixes = ["src/", "lib/", "app/", "pages/"];
    const testPrefixes = ["tests/", "test/", "__tests__/"];
    for (const sp of srcPrefixes) {
      if (normalized.startsWith(sp)) {
        const rest = normalized.slice(sp.length);
        const restDir = dirname(rest);
        const restBase = basename(rest).replace(/\.(ts|tsx|js|jsx)$/, "");
        for (const tp of testPrefixes) {
          candidates.push(
            `${tp}${restDir}/${restBase}.test${testExt}`,
            `${tp}${restDir}/${restBase}.spec${testExt}`,
            `${tp}${restBase}.test${testExt}`,
            `${tp}${restBase}.spec${testExt}`,
          );
        }
      }
    }

    let matched: string | null = null;
    for (const c of candidates) {
      // Normalize candidate (handle ./ prefix from dirname of top-level files)
      const clean = c.replace(/^\.\//, "");
      if (testSet.has(clean)) {
        matched = clean;
        break;
      }
    }

    mapping.set(normalized, matched);
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

type CategoryName =
  | "api-routes"
  | "components"
  | "utils"
  | "middleware"
  | "models"
  | "other";

function categorizeFile(filePath: string): CategoryName {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const base = basename(normalized);
  const ext = extname(normalized);

  // API routes
  if (
    parts.includes("api") ||
    parts.includes("routes") ||
    normalized.includes("app/api/") ||
    normalized.includes("pages/api/")
  ) {
    return "api-routes";
  }

  // Middleware
  if (
    base.startsWith("middleware") ||
    parts.includes("middleware")
  ) {
    return "middleware";
  }

  // Models / schemas / entities
  if (
    parts.includes("models") ||
    parts.includes("schemas") ||
    parts.includes("entities")
  ) {
    return "models";
  }

  // Components: .tsx files or in components/ directory
  if (parts.includes("components") || ext === ".tsx") {
    return "components";
  }

  // Utils / lib / helpers
  if (
    parts.includes("utils") ||
    parts.includes("lib") ||
    parts.includes("helpers")
  ) {
    return "utils";
  }

  return "other";
}

function buildCategories(
  sourceFiles: string[],
  mapping: Map<string, string | null>,
): TestCategory[] {
  const buckets = new Map<string, { sources: string[]; tests: string[]; untested: string[] }>();

  for (const src of sourceFiles) {
    const normalized = src.replace(/\\/g, "/");
    const cat = categorizeFile(normalized);
    if (!buckets.has(cat)) {
      buckets.set(cat, { sources: [], tests: [], untested: [] });
    }
    const bucket = buckets.get(cat)!;
    bucket.sources.push(normalized);

    const testFile = mapping.get(normalized);
    if (testFile) {
      bucket.tests.push(testFile);
    } else {
      bucket.untested.push(normalized);
    }
  }

  // Sort categories in a stable order
  const order: CategoryName[] = [
    "api-routes",
    "components",
    "utils",
    "middleware",
    "models",
    "other",
  ];

  const categories: TestCategory[] = [];
  for (const name of order) {
    const bucket = buckets.get(name);
    if (bucket && bucket.sources.length > 0) {
      categories.push({
        name,
        sourceFiles: bucket.sources.sort(),
        testFiles: bucket.tests.sort(),
        untestedFiles: bucket.untested.sort(),
      });
    }
  }

  return categories;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function analyzeTestCoverage(
  projectDir: string,
): Promise<TestAnalysisReport> {
  const pkg = await readPackageJson(projectDir);

  // Detect frameworks
  const { runner, patterns: runnerPatterns } = await detectTestRunner(
    projectDir,
    pkg,
  );
  const { framework, patterns: frameworkPatterns } = await detectAppFramework(
    projectDir,
    pkg,
  );
  const detectedPatterns = [...runnerPatterns, ...frameworkPatterns];

  // Discover files
  const sourceDir = "src";
  const sourceFiles = await discoverSourceFiles(projectDir, sourceDir);
  const testFiles = await discoverTestFiles(projectDir);

  // Build mapping
  const mapping = mapSourceToTests(sourceFiles, testFiles);

  // Compute coverage
  const untestedFiles: string[] = [];
  for (const [src, test] of mapping) {
    if (!test) {
      untestedFiles.push(src);
    }
  }

  const ratio =
    sourceFiles.length > 0 ? testFiles.length / sourceFiles.length : 0;

  // Build categories
  const categories = buildCategories(sourceFiles, mapping);

  return {
    framework: {
      testRunner: runner,
      appFramework: framework,
      detectedPatterns,
    },
    coverage: {
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      ratio: Math.round(ratio * 100) / 100,
      untestedFiles: untestedFiles.sort(),
    },
    categories,
  };
}
