import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { verifyLint } from "../../src/gates/lint-gate.js";

const mockExecSync = vi.mocked(execSync);

describe("verifyLint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed: true on clean lint", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await verifyLint("/fake/project");

    expect(result.gate).toBe("lint");
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(mockExecSync).toHaveBeenCalledWith("npx biome check", {
      cwd: "/fake/project",
      stdio: "pipe",
      timeout: 60_000,
    });
  });

  it("parses biome diagnostic errors with file locations", async () => {
    // Lines must contain "error", " ━━", or "×" to be captured by the filter
    const biomeOutput = [
      "src/app.ts:10:5 error lint/suspicious/noDoubleEquals",
      "src/utils.ts:22:1 error lint/style/useConst",
    ].join("\n");

    const error = Object.assign(new Error("biome check failed"), {
      stdout: Buffer.from(biomeOutput),
      stderr: Buffer.from(""),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.gate).toBe("lint");
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toEqual({
      file: "src/app.ts",
      line: 10,
      message: "error lint/suspicious/noDoubleEquals",
    });
    expect(result.errors[1]).toEqual({
      file: "src/utils.ts",
      line: 22,
      message: "error lint/style/useConst",
    });
  });

  it("parses error lines with separator markers", async () => {
    const biomeOutput = [
      "some/file.ts ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");

    const error = Object.assign(new Error("biome check failed"), {
      stdout: Buffer.from(biomeOutput),
      stderr: Buffer.from(""),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.passed).toBe(false);
    // The separator line contains " ━━" so it's captured
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("caps errors at 50 and adds overflow message", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`src/file${i}.ts:${i + 1}:1 error lint/rule${i} Some error message`);
    }

    const error = Object.assign(new Error("biome check failed"), {
      stdout: Buffer.from(lines.join("\n")),
      stderr: Buffer.from(""),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.passed).toBe(false);
    // 50 capped + 1 overflow message = 51
    expect(result.errors).toHaveLength(51);
    expect(result.errors[50].message).toContain("... and 10 more errors");
  });

  it("returns fallback error when no errors parsed from output", async () => {
    const error = Object.assign(new Error("biome check failed"), {
      stdout: Buffer.from("some unrecognized output\n"),
      stderr: Buffer.from(""),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      "biome check exited with non-zero status but no errors were parsed",
    );
  });

  it("handles biome not installed (stderr error)", async () => {
    const error = Object.assign(new Error("biome not found"), {
      stdout: Buffer.from(""),
      stderr: Buffer.from("error: command not found: biome\n"),
      status: 127,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.passed).toBe(false);
    // stderr contains "error" so it should be picked up
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("combines stdout and stderr for error parsing", async () => {
    const error = Object.assign(new Error("biome check failed"), {
      stdout: Buffer.from("src/a.ts:1:1 error lint/rule1 stdout issue\n"),
      stderr: Buffer.from("src/b.ts:2:1 error lint/rule2 stderr issue\n"),
      status: 1,
    });
    mockExecSync.mockImplementation(() => {
      throw error;
    });

    const result = await verifyLint("/fake/project");

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
