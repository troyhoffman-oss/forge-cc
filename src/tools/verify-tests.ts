import { execSync } from "node:child_process";
import type { GateResult } from "../types.js";

export async function verifyTests(projectDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if the test script exists in package.json
  try {
    const pkgRaw = execSync("node -e \"process.stdout.write(JSON.stringify(require('./package.json')))\"", {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 10_000,
    });
    const pkg = JSON.parse(String(pkgRaw));
    if (!pkg.scripts?.test) {
      return {
        gate: "tests",
        passed: true,
        errors,
        warnings: ["No test script found"],
        duration_ms: Date.now() - start,
      };
    }
  } catch {
    return {
      gate: "tests",
      passed: true,
      errors,
      warnings: ["No test script found"],
      duration_ms: Date.now() - start,
    };
  }

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

    return {
      gate: "tests",
      passed: true,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  } catch (err: unknown) {
    const stdout =
      err instanceof Error && "stdout" in err
        ? String((err as { stdout: Buffer }).stdout)
        : "";
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr: Buffer }).stderr)
        : "";

    const output = `${stdout}\n${stderr}`;

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (
        trimmed.includes("FAIL") ||
        trimmed.includes("AssertionError") ||
        trimmed.includes("Expected") ||
        trimmed.includes("Received")
      ) {
        errors.push(trimmed);
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
      errors.push("Test runner exited with non-zero status");
    }

    return {
      gate: "tests",
      passed: false,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  }
}
