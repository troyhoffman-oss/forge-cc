import { execSync } from "node:child_process";
import type { GateError, GateResult } from "../types.js";
import { buildTestRemediation, buildTestCoverageRemediation } from "./remediation.js";
import { analyzeTestCoverage } from "./test-analysis.js";
import { loadConfig } from "../config/loader.js";

/**
 * Common test failure patterns with file/line info:
 *   FAIL src/foo.test.ts > suite > test name
 *   at src/foo.test.ts:42:10
 */
const TEST_FILE_RE = /^FAIL\s+(.+?)(?:\s+>|$)/;
const STACKTRACE_RE = /at\s+.*?([^\s(]+):(\d+):\d+/;

export async function verifyTests(
  projectDir: string,
  options?: { configRoot?: string },
): Promise<GateResult> {
  const start = Date.now();
  const errors: GateError[] = [];
  const warnings: string[] = [];

  // Load config and run test analysis
  const config = loadConfig(options?.configRoot ?? projectDir);
  const testingConfig = config.testing;
  const analysis = await analyzeTestCoverage(projectDir);

  // Detect whether a test script exists in package.json
  let hasTestScript = false;
  try {
    const pkgRaw = execSync("node -e \"process.stdout.write(JSON.stringify(require('./package.json')))\"", {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 10_000,
    });
    const pkg = JSON.parse(String(pkgRaw));
    hasTestScript = !!pkg.scripts?.test;
  } catch {
    // No package.json or invalid — hasTestScript stays false
  }

  // -----------------------------------------------------------------------
  // Baseline check: If zero test files AND no test script, FAIL immediately
  // -----------------------------------------------------------------------
  if (analysis.coverage.testFiles === 0 && !hasTestScript) {
    const categoryNames = analysis.categories.map(c => c.name).join(", ");
    const msg = `No tests found. ${analysis.coverage.sourceFiles} source file${analysis.coverage.sourceFiles === 1 ? "" : "s"} across ${analysis.categories.length} categor${analysis.categories.length === 1 ? "y" : "ies"} (${categoryNames || "none"}) have no test coverage. Run \`/forge:setup\` to scaffold tests.`;
    const error: GateError = { message: msg };
    error.remediation = buildTestCoverageRemediation(error);
    errors.push(error);

    return {
      gate: "tests",
      passed: false,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  }

  // Also baseline-fail if test files exist but no test script to run them
  if (analysis.coverage.testFiles === 0 && hasTestScript) {
    // Test script exists but no test files found — still baseline fail
    const msg = `No test files found. A test script exists in package.json but no test files were detected. Run \`/forge:setup\` to scaffold tests.`;
    const error: GateError = { message: msg };
    error.remediation = buildTestCoverageRemediation(error);
    errors.push(error);

    return {
      gate: "tests",
      passed: false,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  }

  // -----------------------------------------------------------------------
  // Run tests (if a test script exists)
  // -----------------------------------------------------------------------
  let testsRanSuccessfully = true;

  if (hasTestScript) {
    try {
      const result = execSync("npm run test -- --run", {
        cwd: projectDir,
        stdio: "pipe",
        timeout: 300_000,
      });

      const output = String(result);

      // Parse test summary from Vitest output
      const summaryMatch = output.match(
        /Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+failed)?/
      );
      if (summaryMatch) {
        const passed = summaryMatch[1];
        const failed = summaryMatch[2] ?? "0";
        warnings.push(`${passed} passed, ${failed} failed`);
      }
    } catch (err: unknown) {
      testsRanSuccessfully = false;

      const stdout =
        err instanceof Error && "stdout" in err
          ? String((err as { stdout: Buffer }).stdout)
          : "";
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as { stderr: Buffer }).stderr)
          : "";

      const output = `${stdout}\n${stderr}`;
      let lastFailFile: string | undefined;

      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Track which test file we're in
        const failMatch = TEST_FILE_RE.exec(trimmed);
        if (failMatch) {
          lastFailFile = failMatch[1];
        }

        // Try to extract stack trace location
        const stackMatch = STACKTRACE_RE.exec(trimmed);
        if (stackMatch) {
          lastFailFile = stackMatch[1];
        }

        if (
          trimmed.includes("FAIL") ||
          trimmed.includes("AssertionError") ||
          trimmed.includes("AssertionError") ||
          trimmed.includes("Expected") ||
          trimmed.includes("Received")
        ) {
          errors.push({
            file: lastFailFile,
            line: stackMatch ? Number.parseInt(stackMatch[2], 10) : undefined,
            message: trimmed,
          });
        }
      }

      // Also try to extract the summary even on failure
      const summaryMatch = output.match(
        /Tests\s+(?:(\d+)\s+passed\s*\|\s*)?(\d+)\s+failed/
      );
      if (summaryMatch) {
        const passed = summaryMatch[1] ?? "0";
        const failed = summaryMatch[2];
        warnings.push(`${passed} passed, ${failed} failed`);
      }

      if (errors.length === 0) {
        errors.push({ message: "Test runner exited with non-zero status" });
      }

      // Enrich errors with remediation hints
      for (const error of errors) {
        error.remediation = buildTestRemediation(error);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Enforcement check: Verify changed files have corresponding tests
  // -----------------------------------------------------------------------
  if (testingConfig?.enforce) {
    const changedSourceFiles = getChangedSourceFiles(projectDir);

    if (changedSourceFiles.length > 0) {
      const untestedSet = new Set(analysis.coverage.untestedFiles);

      for (const file of changedSourceFiles) {
        const normalized = file.replace(/\\/g, "/");
        if (untestedSet.has(normalized)) {
          const error: GateError = {
            file: normalized,
            message: `Missing test file for changed source: ${normalized}`,
          };
          error.remediation = buildTestCoverageRemediation(error);
          errors.push(error);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Thin coverage advisory
  // -----------------------------------------------------------------------
  if (analysis.coverage.testFiles > 0 && analysis.coverage.ratio < 0.3) {
    warnings.push(
      `Thin test coverage: ratio ${analysis.coverage.ratio} (${analysis.coverage.testFiles} test file${analysis.coverage.testFiles === 1 ? "" : "s"} for ${analysis.coverage.sourceFiles} source file${analysis.coverage.sourceFiles === 1 ? "" : "s"}). Consider adding tests for untested files.`
    );
  }

  const passed = testsRanSuccessfully && errors.length === 0;

  return {
    gate: "tests",
    passed,
    errors,
    warnings,
    duration_ms: Date.now() - start,
  };
}

/**
 * Get source files changed relative to HEAD~1 or the staging area.
 * Returns paths relative to projectDir, normalized with forward slashes.
 */
function getChangedSourceFiles(projectDir: string): string[] {
  const files: string[] = [];

  // Try git diff against HEAD~1 first, fall back to cached diff
  for (const cmd of [
    "git diff --name-only HEAD~1",
    "git diff --cached --name-only",
  ]) {
    try {
      const output = execSync(cmd, {
        cwd: projectDir,
        stdio: "pipe",
        timeout: 10_000,
      }).toString().trim();

      if (output) {
        for (const line of output.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Only include source files (not test files, not configs)
          if (isSourceFilePath(trimmed)) {
            files.push(trimmed.replace(/\\/g, "/"));
          }
        }
        break; // Use the first successful command
      }
    } catch {
      // Command failed — try the next one
    }
  }

  return files;
}

/** Check if a path looks like a source file (TS/JS, not a test, not a declaration). */
function isSourceFilePath(filePath: string): boolean {
  if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return false;
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath)) return false;
  if (filePath.endsWith(".d.ts")) return false;
  return true;
}
