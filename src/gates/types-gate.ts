import { execSync } from "node:child_process";
import type { GateError, GateResult } from "../types.js";

/** Regex to parse tsc error lines: src/foo.ts(10,5): error TS2322: ... */
const TSC_ERROR_RE = /^(.+?)\((\d+),\d+\):\s*(.+)$/;

export async function verifyTypes(projectDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: GateError[] = [];
  const warnings: string[] = [];

  try {
    execSync("npx tsc --noEmit", {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 120_000,
    });

    return {
      gate: "types",
      passed: true,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  } catch (err: unknown) {
    const output =
      err instanceof Error && "stdout" in err
        ? String((err as { stdout: Buffer }).stdout)
        : "";

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.toLowerCase().includes("warning")) {
        warnings.push(trimmed);
      } else if (trimmed.includes("error TS")) {
        const match = TSC_ERROR_RE.exec(trimmed);
        if (match) {
          errors.push({
            file: match[1],
            line: Number.parseInt(match[2], 10),
            message: match[3],
          });
        } else {
          errors.push({ message: trimmed });
        }
      }
    }

    if (errors.length === 0) {
      errors.push({ message: "tsc exited with non-zero status but no TS errors were parsed" });
    }

    return {
      gate: "types",
      passed: false,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  }
}
