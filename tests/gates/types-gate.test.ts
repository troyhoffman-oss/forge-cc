import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { verifyTypes } from "../../src/gates/types-gate.js";

const mockExecSync = vi.mocked(execSync);

describe("verifyTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed: true on clean compilation", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await verifyTypes("/fake/project");

    expect(result.gate).toBe("types");
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(mockExecSync).toHaveBeenCalledWith("npx tsc --noEmit", {
      cwd: "/fake/project",
      stdio: "pipe",
      timeout: 120_000,
    });
  });

  it("parses TypeScript errors into GateError objects", async () => {
    const tscOutput = [
      "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/bar.ts(42,1): error TS2304: Cannot find name 'baz'.",
      "",
    ].join("\n");

    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(tscOutput),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyTypes("/fake/project");

    expect(result.gate).toBe("types");
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toEqual({
      file: "src/foo.ts",
      line: 10,
      message: "error TS2322: Type 'string' is not assignable to type 'number'.",
    });
    expect(result.errors[1]).toEqual({
      file: "src/bar.ts",
      line: 42,
      message: "error TS2304: Cannot find name 'baz'.",
    });
  });

  it("captures warnings separately from errors", async () => {
    const tscOutput = [
      "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "Warning: some deprecation warning here",
    ].join("\n");

    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(tscOutput),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyTypes("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Warning");
  });

  it("handles unparseable error lines", async () => {
    const tscOutput = "error TS6053: File not found\n";

    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(tscOutput),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyTypes("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    // Non-matching TS error lines get pushed as message-only
    expect(result.errors[0]).toEqual({ message: "error TS6053: File not found" });
  });

  it("returns fallback error when no TS errors are parsed from output", async () => {
    const error = Object.assign(new Error("tsc failed"), {
      stdout: Buffer.from(""),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyTypes("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      "tsc exited with non-zero status but no TS errors were parsed",
    );
  });

  it("handles timeout errors (non-Error thrown)", async () => {
    // When err is not instanceof Error (no stdout property)
    mockExecSync.mockImplementation(() => {
      throw "timeout string error";
    });

    const result = await verifyTypes("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      "tsc exited with non-zero status but no TS errors were parsed",
    );
  });
});
