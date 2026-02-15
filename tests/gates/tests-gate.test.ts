import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { verifyTests } from "../../src/gates/tests-gate.js";

const mockExecSync = vi.mocked(execSync);

describe("verifyTests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed: true when all tests pass", async () => {
    // First call: reads package.json (has test script)
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      // Second call: runs tests
      return Buffer.from("Tests 12 passed");
    });

    const result = await verifyTests("/fake/project");

    expect(result.gate).toBe("tests");
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("includes test summary in warnings on success", async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      return Buffer.from("Tests 12 passed | 0 failed");
    });

    const result = await verifyTests("/fake/project");

    expect(result.passed).toBe(true);
    expect(result.warnings).toContain("12 passed, 0 failed");
  });

  it("returns passed: true with warning when no test script in package.json", async () => {
    // package.json exists but has no test script
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: {} }));
      }
      return Buffer.from("");
    });

    const result = await verifyTests("/fake/project");

    expect(result.gate).toBe("tests");
    expect(result.passed).toBe(true);
    expect(result.warnings).toContain("No test script found");
    // execSync should only be called once (for package.json check)
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it("returns passed: true with warning when package.json cannot be read", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("cannot read package.json");
    });

    const result = await verifyTests("/fake/project");

    expect(result.gate).toBe("tests");
    expect(result.passed).toBe(true);
    expect(result.warnings).toContain("No test script found");
  });

  it("parses test failures into GateError objects", async () => {
    const testOutput = [
      "FAIL src/foo.test.ts > suite > test name",
      "  at src/foo.test.ts:42:10",
      "  Expected: 1",
      "  Received: 2",
      "",
      "Tests 3 passed | 1 failed",
    ].join("\n");

    let callIndex = 0;
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      // Test run fails
      const error = Object.assign(new Error("tests failed"), {
        stdout: Buffer.from(testOutput),
        stderr: Buffer.from(""),
        status: 1,
      });
      throw error;
    });

    const result = await verifyTests("/fake/project");

    expect(result.gate).toBe("tests");
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    // Should have FAIL and Expected/Received lines as errors
    const failError = result.errors.find((e) => e.message.includes("FAIL"));
    expect(failError).toBeDefined();
  });

  it("includes test summary in warnings even on failure", async () => {
    const testOutput = [
      "FAIL src/foo.test.ts > test",
      "Tests 3 passed | 2 failed",
    ].join("\n");

    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      const error = Object.assign(new Error("tests failed"), {
        stdout: Buffer.from(testOutput),
        stderr: Buffer.from(""),
        status: 1,
      });
      throw error;
    });

    const result = await verifyTests("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.warnings).toContain("3 passed, 2 failed");
  });

  it("returns fallback error when test runner fails with no parseable output", async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const command = String(cmd);
      if (command.includes("package.json")) {
        return Buffer.from(JSON.stringify({ scripts: { test: "vitest run" } }));
      }
      const error = Object.assign(new Error("tests crashed"), {
        stdout: Buffer.from("something went wrong\n"),
        stderr: Buffer.from(""),
        status: 1,
      });
      throw error;
    });

    const result = await verifyTests("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("Test runner exited with non-zero status");
  });
});
