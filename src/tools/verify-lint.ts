import { execSync } from "node:child_process";
import type { GateResult } from "../types.js";

export async function verifyLint(projectDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    execSync("npx biome check", {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 60_000,
    });

    return {
      gate: "lint",
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
        trimmed.includes(" ━━") ||
        trimmed.toLowerCase().includes("error") ||
        trimmed.includes("×")
      ) {
        errors.push(trimmed);
      }
    }

    // Cap at 50 errors to avoid massive output
    const cappedErrors = errors.slice(0, 50);
    if (errors.length > 50) {
      cappedErrors.push(`... and ${errors.length - 50} more errors`);
    }

    if (cappedErrors.length === 0) {
      cappedErrors.push("biome check exited with non-zero status but no errors were parsed");
    }

    return {
      gate: "lint",
      passed: false,
      errors: cappedErrors,
      warnings,
      duration_ms: Date.now() - start,
    };
  }
}
