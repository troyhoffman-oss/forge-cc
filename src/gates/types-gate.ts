import { spawn } from "node:child_process";
import type { GateError, GateResult } from "../types.js";
import type { Gate } from "./index.js";

/** Parse tsc output lines into structured errors. */
function parseTscOutput(output: string): GateError[] {
  const errors: GateError[] = [];
  // tsc error format: file(line,col): error TSxxxx: message
  const regex = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      message: match[4],
    });
  }
  return errors;
}

function runTsc(projectDir: string): Promise<GateResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("npx", ["tsc", "--noEmit"], {
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
      const errors = parseTscOutput(output);
      resolve({
        gate: "types",
        passed: code === 0,
        errors,
        durationMs: Date.now() - start,
      });
    });

    child.on("error", (err) => {
      resolve({
        gate: "types",
        passed: false,
        errors: [{ file: "", line: 0, message: err.message }],
        durationMs: Date.now() - start,
      });
    });
  });
}

export const typesGate: Gate = {
  name: "types",
  run: runTsc,
};
