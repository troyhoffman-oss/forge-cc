import { execSync } from "node:child_process";
import type { GateError, GateResult } from "../types.js";
import { buildLintRemediation } from "./remediation.js";

/**
 * Biome diagnostics often look like:
 *   path/to/file.ts:10:5 lint/rule ...
 * or header lines with ━━ separators
 */
const BIOME_LOC_RE = /^(.+?):(\d+):\d+\s+(.+)$/;

export async function verifyLint(projectDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: GateError[] = [];
  const warnings: string[] = [];

  try {
    execSync("npx biome check", {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 60_000,
    });

    return { gate: "lint", passed: true, errors, warnings, duration_ms: Date.now() - start };
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
    const rawErrors: GateError[] = [];

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (
        trimmed.includes(" ━━") ||
        trimmed.toLowerCase().includes("error") ||
        trimmed.includes("×")
      ) {
        const match = BIOME_LOC_RE.exec(trimmed);
        if (match) {
          rawErrors.push({
            file: match[1],
            line: Number.parseInt(match[2], 10),
            message: match[3],
          });
        } else {
          rawErrors.push({ message: trimmed });
        }
      }
    }

    // Cap at 50 errors to avoid massive output
    const cappedErrors = rawErrors.slice(0, 50);
    if (rawErrors.length > 50) {
      cappedErrors.push({ message: `... and ${rawErrors.length - 50} more errors` });
    }

    if (cappedErrors.length === 0) {
      cappedErrors.push({ message: "biome check exited with non-zero status but no errors were parsed" });
    }

    // Enrich errors with remediation hints
    for (const error of cappedErrors) {
      error.remediation = buildLintRemediation(error);
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
