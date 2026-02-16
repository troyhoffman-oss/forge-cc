import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process and browser utils before importing modules under test
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../src/utils/browser.js", () => ({
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  getBrowser: vi.fn(),
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
}));

import { execSync } from "node:child_process";
import { gateRegistry, runPipeline } from "../../src/gates/index.js";
import type { PipelineInput } from "../../src/types.js";

const mockExecSync = vi.mocked(execSync);

// --- Helpers ---

function makeInput(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    projectDir: "/fake/project",
    ...overrides,
  };
}

// --- Gate Registry ---

describe("Pipeline / Gate registry", () => {
  it("has all seven expected gates registered", () => {
    const gateNames = Object.keys(gateRegistry);

    expect(gateNames).toContain("types");
    expect(gateNames).toContain("lint");
    expect(gateNames).toContain("tests");
    expect(gateNames).toContain("visual");
    expect(gateNames).toContain("runtime");
    expect(gateNames).toContain("prd");
    expect(gateNames).toContain("review");
    expect(gateNames).toHaveLength(7);
  });

  it("all registry values are functions", () => {
    for (const [name, fn] of Object.entries(gateRegistry)) {
      expect(typeof fn).toBe("function");
    }
  });
});

// --- Single Gate Pipeline ---

describe("Pipeline / Single gate runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs types gate successfully with clean tsc output", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(makeInput({ gates: ["types"] }));

    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(true);
    expect(result.gates[0].errors).toEqual([]);
  });

  it("runs types gate and captures failures", async () => {
    const tscOutput = "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(tscOutput),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await runPipeline(makeInput({ gates: ["types"] }));

    expect(result.passed).toBe(false);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(false);
    expect(result.gates[0].errors.length).toBeGreaterThan(0);
  });

  it("runs lint gate successfully with clean biome output", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(makeInput({ gates: ["lint"] }));

    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe("lint");
    expect(result.gates[0].passed).toBe(true);
  });

  it("runs tests gate successfully", async () => {
    mockExecSync.mockReturnValue(Buffer.from("All tests passed"));

    const result = await runPipeline(makeInput({ gates: ["tests"] }));

    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe("tests");
    expect(result.gates[0].passed).toBe(true);
  });
});

// --- Multi-Gate Pipeline ---

describe("Pipeline / Multiple gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs multiple gates — all pass", async () => {
    // tsc, biome, and tests all succeed
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(makeInput({ gates: ["types", "lint", "tests"] }));

    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(3);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(true);
    expect(result.gates[1].gate).toBe("lint");
    expect(result.gates[1].passed).toBe(true);
    expect(result.gates[2].gate).toBe("tests");
    expect(result.gates[2].passed).toBe(true);
  });

  it("runs multiple gates — some pass, some fail", async () => {
    let callCount = 0;
    mockExecSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // types succeeds
        return Buffer.from("");
      }
      if (callCount === 2) {
        // lint fails
        const error = Object.assign(new Error("biome check failed"), {
          stdout: Buffer.from("src/app.ts:10:5 lint/style/noUnusedVariables"),
          status: 1,
        });
        throw error;
      }
      // tests succeed
      return Buffer.from("All tests passed");
    });

    const result = await runPipeline(makeInput({ gates: ["types", "lint", "tests"] }));

    expect(result.passed).toBe(false); // overall fails because lint failed
    expect(result.gates).toHaveLength(3);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(true);
    expect(result.gates[1].gate).toBe("lint");
    expect(result.gates[1].passed).toBe(false);
    expect(result.gates[2].gate).toBe("tests");
    expect(result.gates[2].passed).toBe(true);
  });

  it("handles unknown gate name gracefully", async () => {
    const result = await runPipeline(makeInput({ gates: ["nonexistent-gate"] }));

    expect(result.passed).toBe(false);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe("nonexistent-gate");
    expect(result.gates[0].passed).toBe(false);
    expect(result.gates[0].errors[0].message).toContain("Unknown gate");
  });

  it("mixes unknown and known gates", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(
      makeInput({ gates: ["types", "bogus-gate", "lint"] }),
    );

    expect(result.passed).toBe(false); // bogus gate fails
    expect(result.gates).toHaveLength(3);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(true);
    expect(result.gates[1].gate).toBe("bogus-gate");
    expect(result.gates[1].passed).toBe(false);
    expect(result.gates[2].gate).toBe("lint");
    expect(result.gates[2].passed).toBe(true);
  });
});

// --- Early Exit on Core Gate Failure ---

describe("Pipeline / Early exit on all core gate failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips remaining gates when all three core gates fail", async () => {
    // The tests gate calls execSync twice:
    //   1) to read package.json (must succeed with a test script)
    //   2) to run `npm run test` (must fail)
    // Types and lint each call execSync once (must fail).
    let callCount = 0;
    mockExecSync.mockImplementation((cmd: unknown) => {
      callCount++;
      const cmdStr = String(cmd);

      // Tests gate package.json check — return valid package with test script
      if (cmdStr.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }

      // Everything else (tsc, biome, npm run test) fails
      const error = Object.assign(new Error("gate failed"), {
        stdout: Buffer.from("error output"),
        status: 1,
      });
      throw error;
    });

    const result = await runPipeline(
      makeInput({ gates: ["types", "lint", "tests", "prd"] }),
    );

    expect(result.passed).toBe(false);

    // types, lint, tests all ran and failed
    const typesGate = result.gates.find((g) => g.gate === "types");
    const lintGate = result.gates.find((g) => g.gate === "lint");
    const testsGate = result.gates.find((g) => g.gate === "tests");

    expect(typesGate?.passed).toBe(false);
    expect(lintGate?.passed).toBe(false);
    expect(testsGate?.passed).toBe(false);

    // prd should be skipped
    const prdGate = result.gates.find((g) => g.gate === "prd");
    expect(prdGate).toBeDefined();
    expect(prdGate?.passed).toBe(false);
    expect(prdGate?.warnings).toContain("Skipped due to core gate failures");
  });

  it("does NOT skip when only 2 of 3 core gates fail", async () => {
    let callCount = 0;
    mockExecSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // types fails
        const error = Object.assign(new Error("tsc failed"), {
          stdout: Buffer.from("error TS2322"),
          status: 1,
        });
        throw error;
      }
      // lint succeeds, tests succeed
      return Buffer.from("");
    });

    const result = await runPipeline(
      makeInput({ gates: ["types", "lint", "tests"] }),
    );

    // All 3 gates should have run (not early-exited)
    expect(result.gates).toHaveLength(3);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(false);
    expect(result.gates[1].gate).toBe("lint");
    expect(result.gates[1].passed).toBe(true);
    expect(result.gates[2].gate).toBe("tests");
    expect(result.gates[2].passed).toBe(true);
  });
});

// --- Gate Crash Safety (runGateSafe) ---

describe("Pipeline / runGateSafe crash handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures gate that throws an unhandled error", async () => {
    // Simulate a gate that crashes with an unexpected error
    mockExecSync.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined");
    });

    const result = await runPipeline(makeInput({ gates: ["types"] }));

    expect(result.passed).toBe(false);
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(false);
    // The error should be captured, not propagated
    expect(result.gates[0].errors.length).toBeGreaterThan(0);
  });

  it("captures gate that throws a non-Error value", async () => {
    mockExecSync.mockImplementation(() => {
      throw "string error value";
    });

    const result = await runPipeline(makeInput({ gates: ["types"] }));

    expect(result.passed).toBe(false);
    expect(result.gates[0].passed).toBe(false);
    expect(result.gates[0].errors.length).toBeGreaterThan(0);
  });

  it("continues running other gates after one crashes", async () => {
    let callCount = 0;
    mockExecSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // types crashes
        throw new Error("Unexpected crash in tsc");
      }
      // lint succeeds
      return Buffer.from("");
    });

    const result = await runPipeline(makeInput({ gates: ["types", "lint"] }));

    expect(result.gates).toHaveLength(2);
    expect(result.gates[0].gate).toBe("types");
    expect(result.gates[0].passed).toBe(false);
    expect(result.gates[1].gate).toBe("lint");
    expect(result.gates[1].passed).toBe(true);
  });
});

// --- Pipeline Metadata ---

describe("Pipeline / Metadata and defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses default gates when none specified", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(makeInput({ gates: undefined }));

    // Default should be types, lint, tests
    expect(result.gates.map((g) => g.gate)).toEqual(["types", "lint", "tests"]);
  });

  it("uses default maxIterations of 3", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(makeInput({ gates: ["types"] }));

    expect(result.maxIterations).toBe(3);
  });

  it("respects custom maxIterations", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(
      makeInput({ gates: ["types"], maxIterations: 10 }),
    );

    expect(result.maxIterations).toBe(10);
  });

  it("always returns iteration: 1 (single-pass pipeline)", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(makeInput({ gates: ["types"] }));

    expect(result.iteration).toBe(1);
  });

  it("result.report is empty string (reporter handles this separately)", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runPipeline(makeInput({ gates: ["types"] }));

    expect(result.report).toBe("");
  });

  it("empty gates array produces passing result with no gate results", async () => {
    const result = await runPipeline(makeInput({ gates: [] }));

    expect(result.passed).toBe(true);
    expect(result.gates).toHaveLength(0);
  });
});
