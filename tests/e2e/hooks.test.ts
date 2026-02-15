import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { checkPreCommit } from "../../src/hooks/pre-commit.js";
import type { GateResult, VerifyCache } from "../../src/types.js";

const mockExecSync = vi.mocked(execSync);

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

function setupProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-hook-test-"));
  // Needs a .forge.json for loadConfig
  writeFileSync(
    join(dir, ".forge.json"),
    JSON.stringify({
      gates: ["types"],
      maxIterations: 3,
      verifyFreshness: 300_000, // 5 minutes
    }),
  );
  return dir;
}

function writeVerifyCache(projectDir: string, cache: VerifyCache): void {
  const forgeDir = join(projectDir, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(forgeDir, "last-verify.json"), JSON.stringify(cache, null, 2));
}

// --- Tests ---

describe("checkPreCommit", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    projectDir = setupProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("blocks commit when on main branch", () => {
    mockExecSync.mockReturnValue("main" as unknown as Buffer);

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot commit directly to main");
    expect(result.reason).toContain("Create a feature branch first");
  });

  it("blocks commit when on master branch", () => {
    mockExecSync.mockReturnValue("master" as unknown as Buffer);

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot commit directly to master");
  });

  it("blocks commit when no verify cache exists", () => {
    mockExecSync.mockReturnValue("feat/my-feature" as unknown as Buffer);

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No verification found");
    expect(result.reason).toContain("npx forge verify");
  });

  it("blocks commit when verify cache has passed: false", () => {
    mockExecSync.mockReturnValue("feat/my-feature" as unknown as Buffer);

    writeVerifyCache(projectDir, {
      passed: false,
      timestamp: new Date().toISOString(),
      gates: [makeGate({ gate: "types", passed: false })],
      branch: "feat/my-feature",
    });

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Last verification FAILED");
    expect(result.reason).toContain("npx forge verify");
  });

  it("blocks commit when verify cache is stale (older than verifyFreshness)", () => {
    mockExecSync.mockReturnValue("feat/my-feature" as unknown as Buffer);

    // Write cache with a timestamp 10 minutes ago (> 5 min freshness)
    const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString();

    writeVerifyCache(projectDir, {
      passed: true,
      timestamp: staleTimestamp,
      gates: [makeGate({ gate: "types", passed: true })],
      branch: "feat/my-feature",
    });

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("stale");
    expect(result.reason).toContain("npx forge verify");
  });

  it("allows commit on feature branch with fresh passing verify", () => {
    mockExecSync.mockReturnValue("feat/my-feature" as unknown as Buffer);

    // Write cache with current timestamp and passed: true
    writeVerifyCache(projectDir, {
      passed: true,
      timestamp: new Date().toISOString(),
      gates: [makeGate({ gate: "types", passed: true })],
      branch: "feat/my-feature",
    });

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("allows commit when git branch check fails (non-git directory)", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    // Even without a git repo, need a fresh cache for the verify check
    writeVerifyCache(projectDir, {
      passed: true,
      timestamp: new Date().toISOString(),
      gates: [makeGate({ gate: "types", passed: true })],
      branch: "unknown",
    });

    const result = checkPreCommit(projectDir);

    // Branch check fails silently (allowed), but cache check still applies
    expect(result.allowed).toBe(true);
  });

  it("blocks commit when cache file is corrupted JSON", () => {
    mockExecSync.mockReturnValue("feat/my-feature" as unknown as Buffer);

    // Write invalid JSON to cache
    const forgeDir = join(projectDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(join(forgeDir, "last-verify.json"), "{invalid json");

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Could not read verification cache");
  });

  it("uses verifyFreshness from .forge.json config", () => {
    // Update the config to have a very short freshness (1 second)
    writeFileSync(
      join(projectDir, ".forge.json"),
      JSON.stringify({
        gates: ["types"],
        maxIterations: 3,
        verifyFreshness: 1_000, // 1 second
      }),
    );

    mockExecSync.mockReturnValue("feat/my-feature" as unknown as Buffer);

    // Write cache 2 seconds ago -- just past the 1s freshness
    const oldTimestamp = new Date(Date.now() - 2_000).toISOString();
    writeVerifyCache(projectDir, {
      passed: true,
      timestamp: oldTimestamp,
      gates: [makeGate({ gate: "types", passed: true })],
      branch: "feat/my-feature",
    });

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("stale");
  });

  it("allows with generous freshness window", () => {
    // Config with 1 hour freshness
    writeFileSync(
      join(projectDir, ".forge.json"),
      JSON.stringify({
        gates: ["types"],
        maxIterations: 3,
        verifyFreshness: 3_600_000, // 1 hour
      }),
    );

    mockExecSync.mockReturnValue("feat/my-feature" as unknown as Buffer);

    // Write cache 5 minutes ago -- well within 1 hour freshness
    const recentTimestamp = new Date(Date.now() - 5 * 60_000).toISOString();
    writeVerifyCache(projectDir, {
      passed: true,
      timestamp: recentTimestamp,
      gates: [makeGate({ gate: "types", passed: true })],
      branch: "feat/my-feature",
    });

    const result = checkPreCommit(projectDir);

    expect(result.allowed).toBe(true);
  });
});
