import { describe, it, expect } from "vitest";
import {
  getUnresolvedComments,
  formatCommentForFix,
} from "../../src/gates/codex-gate.js";
import type { CodexComment } from "../../src/team/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(overrides?: Partial<CodexComment>): CodexComment {
  return {
    id: 1,
    body: "Fix this issue",
    path: "src/foo.ts",
    line: 10,
    resolved: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getUnresolvedComments
// ---------------------------------------------------------------------------

describe("getUnresolvedComments", () => {
  it("filters to unresolved comments only", () => {
    const comments: CodexComment[] = [
      makeComment({ id: 1, resolved: false }),
      makeComment({ id: 2, resolved: true }),
      makeComment({ id: 3, resolved: false }),
    ];

    const unresolved = getUnresolvedComments(comments);

    expect(unresolved).toHaveLength(2);
    expect(unresolved.map((c) => c.id)).toEqual([1, 3]);
  });

  it("returns empty array when all comments are resolved", () => {
    const comments: CodexComment[] = [
      makeComment({ id: 1, resolved: true }),
      makeComment({ id: 2, resolved: true }),
    ];

    const unresolved = getUnresolvedComments(comments);
    expect(unresolved).toEqual([]);
  });

  it("returns empty array when input is empty", () => {
    const unresolved = getUnresolvedComments([]);
    expect(unresolved).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatCommentForFix
// ---------------------------------------------------------------------------

describe("formatCommentForFix", () => {
  it("includes id, path, and body", () => {
    const comment = makeComment({
      id: 42,
      path: "src/bar.ts",
      body: "Add error handling",
      line: 15,
    });

    const formatted = formatCommentForFix(comment);

    expect(formatted).toContain("42");
    expect(formatted).toContain("src/bar.ts");
    expect(formatted).toContain("Add error handling");
  });

  it("includes line number when present", () => {
    const comment = makeComment({ path: "src/baz.ts", line: 99 });

    const formatted = formatCommentForFix(comment);

    expect(formatted).toContain("src/baz.ts:99");
  });

  it("handles missing line number", () => {
    const comment = makeComment({ path: "src/qux.ts", line: undefined });

    const formatted = formatCommentForFix(comment);

    // Should show path without line number, not "src/qux.ts:undefined"
    expect(formatted).toContain("src/qux.ts");
    expect(formatted).not.toContain("undefined");
  });
});
