import { spawn } from "node:child_process";
import type { GateError, GateResult } from "../types.js";
import type { Gate } from "./index.js";

/** Parse biome check output into structured errors. */
function parseBiomeOutput(output: string): GateError[] {
  const errors: GateError[] = [];
  // Biome diagnostic format: file:line:col category LEVEL message
  // e.g. src/foo.ts:10:5 lint/style/noVar  FIXABLE  ERROR  Use 'let' or 'const' instead of 'var'.
  // Also handles: file.ts:line:col  lint/rule  ━━━━━  then message on following lines
  // Simplified parser: look for lines with file:line:col pattern
  const regex = /^\s*(.+?):(\d+):(\d+)\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const rest = match[4].trim();
    // Extract rule name if present (e.g. lint/style/noVar)
    const ruleMatch = /^([\w/]+)\s+(.*)$/.exec(rest);
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      message: ruleMatch ? ruleMatch[2] : rest,
      rule: ruleMatch ? ruleMatch[1] : undefined,
    });
  }
  return errors;
}

function runBiome(projectDir: string): Promise<GateResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("npx", ["biome", "check", "."], {
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
