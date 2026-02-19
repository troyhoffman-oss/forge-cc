import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GateError, GateResult } from "../types.js";
import type { Gate } from "./index.js";

type Runner = "vitest" | "jest" | "unknown";

/** Detect test runner from package.json dependencies. */
async function detectRunner(projectDir: string): Promise<Runner> {
  try {
    const content = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    if ("vitest" in deps) return "vitest";
    if ("jest" in deps) return "jest";
  } catch {
    // No package.json — fall through
  }
  return "unknown";
}

async function runTestRunner(projectDir: string): Promise<GateResult> {
  const start = Date.now();
  const runner = await detectRunner(projectDir);

  if (runner === "unknown") {
    return {
      gate: "tests",
      passed: false,
      errors: [{ file: "", line: 0, message: "No test runner detected (install vitest or jest)" }],
      durationMs: Date.now() - start,
    };
  }

  const cmd = runner === "vitest" ? ["vitest", "run"] : ["jest", "--ci"];

  return new Promise((resolve) => {
    const child = spawn("npx", cmd, {
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
      const errors: GateError[] = [];
      if (code !== 0) {
        const output = stdout + stderr;
        const failRegex = /FAIL\s+(.+)/g;
        let match: RegExpExecArray | null;
        while ((match = failRegex.exec(output)) !== null) {
          errors.push({
            file: match[1].trim(),
            line: 0,
            message: `Test suite failed: ${match[1].trim()}`,
          });
        }
        if (errors.length === 0) {
          errors.push({
            file: "",
            line: 0,
            message: `Test runner exited with code ${code}`,
          });
        }
      }
      resolve({
        gate: "tests",
        passed: code === 0,
        errors,
        durationMs: Date.now() - start,
      });
    });

    child.on("error", (err) => {
      resolve({
        gate: "tests",
        passed: false,
        errors: [{ file: "", line: 0, message: err.message }],
        durationMs: Date.now() - start,
      });
    });
  });
}

export const testsGate: Gate = {
  name: "tests",
  run: runTestRunner,
};
