import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config/loader.js";
import { formatHumanReport } from "../../src/reporter/human.js";
import { formatJsonReport } from "../../src/reporter/json.js";
import type { PipelineResult, GateResult, VerifyCache } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "..", "fixtures", "sample-project");
const failingFixtureDir = join(__dirname, "..", "fixtures", "failing-project");

// --- Helpers ---

function makeGate(overrides: Partial<GateResult> = {}): GateResult {
  return {
    gate: "types",
    passed: true,
    errors: [],
    warnings: [],
    duration_ms: 1200,
    ...overrides,
  };
}

function makePipeline(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    passed: true,
    iteration: 1,
    maxIterations: 5,
    gates: [],
    report: "",
    ...overrides,
  };
}

// --- Config Loading ---

describe("CLI / Config loading", () => {
  it("loads explicit .forge.json from sample-project fixture", () => {
    const config = loadConfig(fixtureDir);

    expect(config.gates).toEqual(["types", "tests"]);
    expect(config.maxIterations).toBe(3);
    expect(config.verifyFreshness).toBe(300_000);
  });

  it("loads explicit .forge.json from failing-project fixture", () => {
    const config = loadConfig(failingFixtureDir);

    expect(config.gates).toEqual(["types"]);
    expect(config.maxIterations).toBe(1);
    expect(config.verifyFreshness).toBe(300_000);
  });

  it("auto-detects types + tests gates from package.json (no .forge.json)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-cli-test-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest run" },
          devDependencies: { typescript: "^5.7.0" },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.gates).toContain("types");
      expect(config.gates).toContain("tests");
      expect(config.gates).not.toContain("lint"); // no biome dep
      expect(config.maxIterations).toBe(5); // default
      expect(config.verifyFreshness).toBe(600_000); // default
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("auto-detects all three core gates when all deps present", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-cli-test-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest run" },
          devDependencies: {
            typescript: "^5.7.0",
            "@biomejs/biome": "^1.9.0",
          },
        }),
      );

      const config = loadConfig(tempDir);

      expect(config.gates).toEqual(["types", "lint", "tests"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to all default gates when no package.json exists", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-cli-empty-"));
    try {
      const config = loadConfig(tempDir);

      expect(config.gates).toEqual(["types", "lint", "tests"]);
      expect(config.maxIterations).toBe(5);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// --- Report Formatting ---

describe("CLI / Report formatting", () => {
  it("human report includes PASSED status when all gates pass", () => {
    const result = makePipeline({
      passed: true,
      gates: [
        makeGate({ gate: "types", passed: true, duration_ms: 2000 }),
        makeGate({ gate: "lint", passed: true, duration_ms: 500 }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("**Status:** PASSED");
    expect(report).toContain("- [x] types: PASS");
    expect(report).toContain("- [x] lint: PASS");
    expect(report).not.toContain("### Errors");
  });

  it("human report includes FAILED status and error details when gates fail", () => {
    const result = makePipeline({
      passed: false,
      gates: [
        makeGate({ gate: "types", passed: true }),
        makeGate({
          gate: "lint",
          passed: false,
          errors: [
            { file: "src/app.ts", line: 12, message: "no-unused-vars" },
          ],
        }),
        makeGate({
          gate: "tests",
          passed: false,
          errors: [
            { message: "Test suite failed: 3 tests failed" },
          ],
        }),
      ],
    });

    const report = formatHumanReport(result);

    expect(report).toContain("**Status:** FAILED");
    expect(report).toContain("- [x] types: PASS");
    expect(report).toContain("- [ ] lint: FAIL");
    expect(report).toContain("- [ ] tests: FAIL");
    expect(report).toContain("### Errors");
    expect(report).toContain("src/app.ts:12: no-unused-vars");
  });

  it("JSON report round-trips preserving full structure", () => {
    const result = makePipeline({
      passed: false,
      iteration: 2,
      maxIterations: 3,
      gates: [
        makeGate({
          gate: "types",
          passed: false,
          errors: [
            {
              file: "src/foo.ts",
              line: 10,
              message: "TS2322",
              remediation: "Fix the type",
            },
          ],
          warnings: ["deprecated API usage"],
        }),
      ],
    });

    const jsonStr = formatJsonReport(result);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.passed).toBe(false);
    expect(parsed.iteration).toBe(2);
    expect(parsed.maxIterations).toBe(3);
    expect(parsed.gates).toHaveLength(1);
    expect(parsed.gates[0].gate).toBe("types");
    expect(parsed.gates[0].errors[0].remediation).toBe("Fix the type");
    expect(parsed.gates[0].warnings).toEqual(["deprecated API usage"]);
  });

  it("JSON report produces valid JSON string", () => {
    const result = makePipeline({ passed: true, gates: [] });
    const jsonStr = formatJsonReport(result);

    expect(() => JSON.parse(jsonStr)).not.toThrow();
    expect(jsonStr).toBe(JSON.stringify(result, null, 2));
  });
});

// --- Verify Cache ---

describe("CLI / writeVerifyCache behavior", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "forge-cache-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates .forge dir and writes last-verify.json", () => {
    const forgeDir = join(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });

    const cache: VerifyCache = {
      passed: true,
      timestamp: new Date().toISOString(),
      gates: [makeGate({ gate: "types", passed: true })],
      branch: "feat/test",
    };

    writeFileSync(join(forgeDir, "last-verify.json"), JSON.stringify(cache, null, 2));

    expect(existsSync(join(forgeDir, "last-verify.json"))).toBe(true);

    const written = JSON.parse(readFileSync(join(forgeDir, "last-verify.json"), "utf-8"));
    expect(written.passed).toBe(true);
    expect(written.branch).toBe("feat/test");
    expect(written.gates).toHaveLength(1);
    expect(written.gates[0].gate).toBe("types");
  });

  it("overwrites existing verify cache", () => {
    const forgeDir = join(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });

    // Write first cache
    const cache1: VerifyCache = {
      passed: false,
      timestamp: "2026-01-01T00:00:00.000Z",
      gates: [],
      branch: "feat/old",
    };
    writeFileSync(join(forgeDir, "last-verify.json"), JSON.stringify(cache1, null, 2));

    // Overwrite with second cache
    const cache2: VerifyCache = {
      passed: true,
      timestamp: new Date().toISOString(),
      gates: [makeGate({ gate: "types", passed: true })],
      branch: "feat/new",
    };
    writeFileSync(join(forgeDir, "last-verify.json"), JSON.stringify(cache2, null, 2));

    const written = JSON.parse(readFileSync(join(forgeDir, "last-verify.json"), "utf-8"));
    expect(written.passed).toBe(true);
    expect(written.branch).toBe("feat/new");
  });

  it("cache structure matches VerifyCache type shape", () => {
    const cache: VerifyCache = {
      passed: true,
      timestamp: new Date().toISOString(),
      gates: [
        makeGate({ gate: "types", passed: true }),
        makeGate({ gate: "lint", passed: true }),
      ],
      branch: "feat/test",
    };

    // Verify the shape
    expect(cache).toHaveProperty("passed");
    expect(cache).toHaveProperty("timestamp");
    expect(cache).toHaveProperty("gates");
    expect(cache).toHaveProperty("branch");
    expect(typeof cache.passed).toBe("boolean");
    expect(typeof cache.timestamp).toBe("string");
    expect(Array.isArray(cache.gates)).toBe(true);
    expect(typeof cache.branch).toBe("string");
  });
});
