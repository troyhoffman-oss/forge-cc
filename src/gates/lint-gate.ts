import { spawn } from "node:child_process";
import type { GateError, GateResult } from "../types.js";
import type { Gate } from "./index.js";

/** Biome JSON reporter diagnostic shape. */
interface BiomeDiagnostic {
  category?: string;
  severity?: string;
  description?: string;
  message?: string;
  location?: {
    path?: { file?: string };
    span?: { start: number; end: number };
    sourceCode?: string;
  };
  advices?: { advices?: Array<{ log?: [string, string] }> };
}

/** Parse biome check --reporter=json output into structured errors. */
function parseBiomeOutput(output: string): GateError[] {
  try {
    const report = JSON.parse(output) as { diagnostics?: BiomeDiagnostic[] };
    if (!report.diagnostics) return [];
    return report.diagnostics
      .filter((d) => d.severity === "error" || d.severity === "warning")
      .map((d) => ({
        file: d.location?.path?.file ?? "",
        line: 0, // JSON reporter doesn't provide line numbers directly; span offsets are byte-based
        column: 0,
        message: d.description ?? d.message ?? "Unknown lint error",
        rule: d.category,
      }));
  } catch {
    // If JSON parsing fails, return a single error with the raw output
    return output.trim()
      ? [{ file: "", line: 0, message: `Biome output parse error: ${output.slice(0, 200)}` }]
      : [];
  }
}

function runBiome(projectDir: string): Promise<GateResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("npx", ["biome", "check", "--reporter=json", "."], {
      cwd: projectDir,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const output = stdout + stderr;
      const errors = parseBiomeOutput(output);
      resolve({
        gate: "lint",
        passed: code === 0,
        errors,
        durationMs: Date.now() - start,
      });
    });

    child.on("error", (err) => {
      resolve({
        gate: "lint",
        passed: false,
        errors: [{ file: "", line: 0, message: err.message }],
        durationMs: Date.now() - start,
      });
    });
  });
}

export const lintGate: Gate = {
  name: "lint",
  run: runBiome,
};
