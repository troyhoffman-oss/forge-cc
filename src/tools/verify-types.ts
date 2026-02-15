import { execSync } from "node:child_process";
import type { GateResult } from "../types.js";

export async function verifyTypes(projectDir: string): Promise<GateResult> {
  const start = Date.now();
  const errors: string[] = [];
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
        errors.push(trimmed);
      }
    }

    if (errors.length === 0) {
      errors.push("tsc exited with non-zero status but no TS errors were parsed");
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
