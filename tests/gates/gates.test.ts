import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn as spawnChild } from "node:child_process";
import {
  registerGate,
  clearGates,
  runPipeline,
  type Gate,
} from "../../src/gates/index.js";
import type { ForgeConfig, GateResult, VerifyCache } from "../../src/types.js";
import { writeVerifyCache } from "../../src/state/cache.js";

function tempDir() {
  return join(tmpdir(), `forge-test-${randomUUID()}`);
}

function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    gates: ["types", "lint", "tests"],
    gateTimeouts: {},
    maxIterations: 5,
    linearTeam: "",
    linearStates: {
      planned: "Planned",
      inProgress: "In Progress",
      inReview: "In Review",
      done: "Done",
    },
    verifyFreshness: 600000,
    forgeVersion: "1.0.0",
    ...overrides,
  };
}

describe("gate registry", () => {
  beforeEach(() => {
    clearGates();
  });

  it("runs gates in registered order", async () => {
    const order: string[] = [];

    const gateA: Gate = {
      name: "a",
      run: async () => {
        order.push("a");
        return { gate: "a", passed: true, errors: [], durationMs: 0 };
      },
    };
    const gateB: Gate = {
      name: "b",
      run: async () => {
        order.push("b");
        return { gate: "b", passed: true, errors: [], durationMs: 0 };
      },
    };
    const gateC: Gate = {
      name: "c",
      run: async () => {
        order.push("c");
        return { gate: "c", passed: true, errors: [], durationMs: 0 };
      },
    };

    registerGate(gateA);
    registerGate(gateB);
    registerGate(gateC);

    const config = makeConfig({ gates: ["a", "b", "c"] });
    await runPipeline(config, process.cwd());

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("respects per-gate timeout (gate that hangs is killed after timeout)", async () => {
    const hangingGate: Gate = {
      name: "hang",
      run: () => new Promise<GateResult>(() => {
        // Never resolves
      }),
    };

    registerGate(hangingGate);

    const config = makeConfig({
      gates: ["hang"],
      gateTimeouts: { hang: 200 },
    });

    const start = Date.now();
    const result = await runPipeline(config, process.cwd());
    const elapsed = Date.now() - start;

    expect(result.result).toBe("FAILED");
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].passed).toBe(false);
    expect(result.gates[0].errors[0].message).toContain("timed out");
    // Should complete within reasonable time of the 200ms timeout
    expect(elapsed).toBeLessThan(2000);
  });

  it("returns structured results with per-gate pass/fail and errors", async () => {
    const passingGate: Gate = {
      name: "pass-gate",
      run: async () => ({
        gate: "pass-gate",
        passed: true,
        errors: [],
        durationMs: 1,
      }),
    };
    const failingGate: Gate = {
      name: "fail-gate",
      run: async () => ({
        gate: "fail-gate",
        passed: false,
        errors: [{ file: "src/bad.ts", line: 10, message: "Type mismatch" }],
        durationMs: 2,
      }),
    };

    registerGate(passingGate);
    registerGate(failingGate);

    const config = makeConfig({ gates: ["pass-gate", "fail-gate"] });
    const result = await runPipeline(config, process.cwd());

    expect(result.result).toBe("FAILED");
    expect(result.gates).toHaveLength(2);

    expect(result.gates[0].gate).toBe("pass-gate");
    expect(result.gates[0].passed).toBe(true);
    expect(result.gates[0].errors).toEqual([]);

    expect(result.gates[1].gate).toBe("fail-gate");
    expect(result.gates[1].passed).toBe(false);
    expect(result.gates[1].errors).toHaveLength(1);
    expect(result.gates[1].errors[0].file).toBe("src/bad.ts");
    expect(result.gates[1].errors[0].line).toBe(10);
    expect(result.gates[1].errors[0].message).toBe("Type mismatch");

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("types gate", () => {
  it("parses tsc error output into { file, line, message } format", async () => {
    // Use the failing-project fixture which has an intentional type error
    const fixtureDir = join(__dirname, "..", "fixtures", "failing-project");

    clearGates();
    const { typesGate } = await import("../../src/gates/types-gate.js");
    registerGate(typesGate);

    const config = makeConfig({ gates: ["types"] });
    const result = await runPipeline(config, fixtureDir);

    expect(result.result).toBe("FAILED");
    expect(result.gates).toHaveLength(1);

    const typesResult = result.gates[0];
    expect(typesResult.gate).toBe("types");
    expect(typesResult.passed).toBe(false);
    expect(typesResult.errors.length).toBeGreaterThan(0);

    // The error should have structured fields
    const err = typesResult.errors[0];
    expect(err.file).toBeTruthy();
    expect(err.line).toBeGreaterThan(0);
    expect(err.message).toBeTruthy();
  }, 30000);
});

describe("verify cache", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("writes valid JSON with timestamp and gate results", async () => {
    const dir = tempDir();
    await mkdir(dir, { recursive: true });
    dirs.push(dir);

    const pipeline = {
      result: "PASSED" as const,
      gates: [
        {
          gate: "types",
          passed: true,
          errors: [],
          durationMs: 100,
        },
        {
          gate: "lint",
          passed: false,
          errors: [{ file: "src/foo.ts", line: 5, message: "unused var" }],
          durationMs: 200,
        },
      ],
      durationMs: 300,
    };

    await writeVerifyCache(dir, pipeline);

    const cachePath = join(dir, ".forge", "last-verify.json");
    const raw = await readFile(cachePath, "utf-8");
    const cache = JSON.parse(raw) as VerifyCache;

    expect(cache.timestamp).toBeTruthy();
    // Verify it's a valid ISO timestamp
    expect(new Date(cache.timestamp).toISOString()).toBe(cache.timestamp);

    expect(cache.result).toBe("PASSED");

    expect(cache.gates.types).toBeDefined();
    expect(cache.gates.types.passed).toBe(true);

    expect(cache.gates.lint).toBeDefined();
    expect(cache.gates.lint.passed).toBe(false);
    expect(cache.gates.lint.errors).toHaveLength(1);
    expect(cache.gates.lint.errors![0].file).toBe("src/foo.ts");
  });
});

describe("forge verify --json", () => {
  it("outputs parseable JSON to stdout", async () => {
    const fixtureDir = join(__dirname, "..", "fixtures", "sample-project");
    const cliPath = join(__dirname, "..", "..", "dist", "cli.js");

    const result = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
      const child = spawnChild("node", [cliPath, "verify", "--gate", "types", "--json"], {
        cwd: fixtureDir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.on("close", (code) => {
        resolve({ stdout, code });
      });

      child.on("error", () => {
        resolve({ stdout: "", code: 1 });
      });
    });

    // The output should be valid JSON
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("result");
    expect(parsed).toHaveProperty("gates");
    expect(parsed).toHaveProperty("durationMs");
    expect(Array.isArray(parsed.gates)).toBe(true);
  }, 60000);
});
