import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { verifyReview } from "../../src/gates/review-gate.js";
import type { ReviewResult } from "../../src/types.js";

const mockExecSync = vi.mocked(execSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

// --- Fixtures ---

const MOCK_DIFF_WITH_REVIEW_GATE = `diff --git a/src/gates/review-gate.ts b/src/gates/review-gate.ts
new file mode 100644
--- /dev/null
+++ b/src/gates/review-gate.ts
@@ -0,0 +1,50 @@
+import { execSync } from "node:child_process";
+import type { GateError, GateResult, ReviewResult } from "../types.js";
+
+export async function verifyReview() {
+  // register in gateRegistry
+  // check PRD compliance
+  // produce GateError[] with remediation
+}
`;

const MOCK_DIFF_MISSING_REQUIREMENT = `diff --git a/src/utils/helpers.ts b/src/utils/helpers.ts
new file mode 100644
--- /dev/null
+++ b/src/utils/helpers.ts
@@ -0,0 +1,10 @@
+export function formatDate(d: Date): string {
+  return d.toISOString().split("T")[0];
+}
+
+export function capitalize(s: string): string {
+  return s.charAt(0).toUpperCase() + s.slice(1);
+}
`;

const MOCK_DIFF_VIOLATING_RULE = `diff --git a/src/gates/review-gate.ts b/src/gates/review-gate.ts
new file mode 100644
--- /dev/null
+++ b/src/gates/review-gate.ts
@@ -0,0 +1,10 @@
+import { execSync } from "node:child_process";
+
+export async function verifyReview() {
+  // git add -A
+  // git add .
+}
`;

const MOCK_PRD_CONTENT = `## Acceptance Criteria
- [ ] Review gate registered in gateRegistry
- [ ] Review checks PRD compliance
- [ ] Review produces GateError[] with remediation
`;

const MOCK_CLAUDE_MD_CONTENT = `## Learned Rules
- **[agent staging]** Restage all files at wave boundaries
- **[between-wave verify]** Run tsc --noEmit between every wave
`;

const EMPTY_DIFF = "";

// --- Helpers ---

function setupMocks(opts: {
  diff?: string;
  diffThrows?: boolean;
  prdContent?: string;
  prdExists?: boolean;
  claudeMdContent?: string;
  claudeMdExists?: boolean;
}) {
  // git diff
  if (opts.diffThrows) {
    mockExecSync.mockImplementation(() => {
      throw new Error("git diff failed");
    });
  } else {
    mockExecSync.mockReturnValue(opts.diff ?? "");
  }

  // existsSync: check path to decide what to return
  mockExistsSync.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("CLAUDE.md")) return opts.claudeMdExists ?? false;
    // PRD path check
    if (opts.prdExists !== undefined) return opts.prdExists;
    return false;
  });

  // readFileSync: return content based on path
  mockReadFileSync.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("CLAUDE.md")) return opts.claudeMdContent ?? "";
    // Assume PRD path
    return opts.prdContent ?? "";
  });
}

// --- Tests ---

describe("verifyReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed: true with no findings when diff matches all PRD criteria", async () => {
    setupMocks({
      diff: MOCK_DIFF_WITH_REVIEW_GATE,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      claudeMdPath: "/fake/project/CLAUDE.md",
    });

    expect(result.gate).toBe("review");
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.reviewFindings).toBeDefined();
    expect(Array.isArray(result.reviewFindings)).toBe(true);

    // No prd_compliance errors -- all criteria are evidenced in the diff
    const prdErrors = result.reviewFindings.filter(
      (f) => f.type === "prd_compliance" && f.severity === "error",
    );
    expect(prdErrors).toHaveLength(0);
  });

  it("produces prd_compliance finding with remediation when diff misses a PRD requirement", async () => {
    setupMocks({
      diff: MOCK_DIFF_MISSING_REQUIREMENT,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      claudeMdPath: "/fake/project/CLAUDE.md",
    });

    expect(result.gate).toBe("review");
    expect(result.reviewFindings).toBeDefined();

    const prdFindings = result.reviewFindings.filter(
      (f) => f.type === "prd_compliance",
    );
    // At least one PRD criterion should be flagged as missing
    expect(prdFindings.length).toBeGreaterThanOrEqual(1);

    // Each finding must have required fields
    for (const finding of prdFindings) {
      expect(finding.message).toBeTruthy();
      expect(finding.remediation).toBeTruthy();
      expect(finding.source).toBeTruthy();
      expect(finding.severity).toMatch(/^(error|warning)$/);
    }
  });

  it("produces rule_violation finding when diff violates a CLAUDE.md rule", async () => {
    setupMocks({
      diff: MOCK_DIFF_VIOLATING_RULE,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      claudeMdPath: "/fake/project/CLAUDE.md",
    });

    expect(result.gate).toBe("review");
    expect(result.reviewFindings).toBeDefined();

    const ruleViolations = result.reviewFindings.filter(
      (f) => f.type === "rule_violation",
    );
    // The diff contains `git add -A` and `git add .` which violates the agent staging rule
    expect(ruleViolations.length).toBeGreaterThanOrEqual(1);

    for (const violation of ruleViolations) {
      expect(violation.message).toBeTruthy();
      expect(violation.remediation).toBeTruthy();
      expect(violation.source).toBeTruthy();
      expect(violation.severity).toMatch(/^(error|warning)$/);
    }
  });

  it("returns passed: true in non-blocking mode (default) even when findings exist", async () => {
    setupMocks({
      diff: MOCK_DIFF_MISSING_REQUIREMENT,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      claudeMdPath: "/fake/project/CLAUDE.md",
      // blocking defaults to false
    });

    expect(result.gate).toBe("review");
    // Non-blocking: passed is true even with findings
    expect(result.passed).toBe(true);
    // But warnings should be populated
    expect(result.reviewFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("returns passed: false in blocking mode when findings exist", async () => {
    setupMocks({
      diff: MOCK_DIFF_MISSING_REQUIREMENT,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      claudeMdPath: "/fake/project/CLAUDE.md",
      blocking: true,
    });

    expect(result.gate).toBe("review");
    expect(result.passed).toBe(false);
    expect(result.reviewFindings.length).toBeGreaterThanOrEqual(1);
    // Errors array should be populated in blocking mode
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("returns passed: true with a warning when git diff fails", async () => {
    setupMocks({
      diffThrows: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      claudeMdPath: "/fake/project/CLAUDE.md",
    });

    expect(result.gate).toBe("review");
    expect(result.passed).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    // Should mention that diff was not available
    const hasDiffWarning = result.warnings.some(
      (w) => w.toLowerCase().includes("diff") || w.toLowerCase().includes("git"),
    );
    expect(hasDiffWarning).toBe(true);
    expect(result.reviewFindings).toEqual([]);
  });

  it("skips PRD compliance checks when no PRD path is provided", async () => {
    setupMocks({
      diff: MOCK_DIFF_MISSING_REQUIREMENT,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      // No prdPath provided
      claudeMdPath: "/fake/project/CLAUDE.md",
    });

    expect(result.gate).toBe("review");
    expect(result.passed).toBe(true);

    // No PRD compliance findings since no PRD was provided
    const prdFindings = result.reviewFindings.filter(
      (f) => f.type === "prd_compliance",
    );
    expect(prdFindings).toHaveLength(0);
  });

  it("skips rule checks when CLAUDE.md is not found", async () => {
    setupMocks({
      diff: MOCK_DIFF_VIOLATING_RULE,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdExists: false,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      // No claudeMdPath, and existsSync returns false for CLAUDE.md
    });

    expect(result.gate).toBe("review");

    // No rule_violation findings since CLAUDE.md was not found
    const ruleFindings = result.reviewFindings.filter(
      (f) => f.type === "rule_violation",
    );
    expect(ruleFindings).toHaveLength(0);
  });

  it("returns passed: true with empty reviewFindings for an empty diff", async () => {
    setupMocks({
      diff: EMPTY_DIFF,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      claudeMdPath: "/fake/project/CLAUDE.md",
    });

    expect(result.gate).toBe("review");
    expect(result.passed).toBe(true);
    expect(result.reviewFindings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("populates the reviewFindings array with properly structured findings", async () => {
    setupMocks({
      diff: MOCK_DIFF_MISSING_REQUIREMENT,
      prdContent: MOCK_PRD_CONTENT,
      prdExists: true,
      claudeMdContent: MOCK_CLAUDE_MD_CONTENT,
      claudeMdExists: true,
    });

    const result: ReviewResult = await verifyReview("/fake/project", {
      prdPath: "/fake/project/PRD.md",
      claudeMdPath: "/fake/project/CLAUDE.md",
      blocking: true,
    });

    expect(result.reviewFindings).toBeDefined();
    expect(Array.isArray(result.reviewFindings)).toBe(true);

    // Verify each finding conforms to the expected shape
    for (const finding of result.reviewFindings) {
      expect(finding).toHaveProperty("type");
      expect(finding).toHaveProperty("severity");
      expect(finding).toHaveProperty("message");
      expect(finding).toHaveProperty("remediation");
      expect(finding).toHaveProperty("source");

      // Type must be one of the valid enum values
      expect(["prd_compliance", "rule_violation", "style"]).toContain(
        finding.type,
      );
      // Severity must be error or warning
      expect(["error", "warning"]).toContain(finding.severity);
      // Message and remediation must be non-empty strings
      expect(typeof finding.message).toBe("string");
      expect(finding.message.length).toBeGreaterThan(0);
      expect(typeof finding.remediation).toBe("string");
      expect(finding.remediation.length).toBeGreaterThan(0);
      expect(typeof finding.source).toBe("string");
      expect(finding.source.length).toBeGreaterThan(0);

      // Optional fields should be string/number or undefined
      if (finding.file !== undefined) {
        expect(typeof finding.file).toBe("string");
      }
      if (finding.line !== undefined) {
        expect(typeof finding.line).toBe("number");
      }
    }
  });
});
