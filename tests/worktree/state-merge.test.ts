import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeSessionState,
  updateRoadmapMilestoneStatus,
  updateStateMilestoneRow,
} from "../../src/worktree/state-merge.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_STATE = `# Test Project — Project State

**Last Session:** 2026-02-10

## Milestone Progress
| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Foundation | Complete (2026-02-01) |
| 2 | Integration | In Progress |
| 3 | Polish | Pending |
`;

const SAMPLE_ROADMAP = `# Test Project — Roadmap

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Foundation | Complete (2026-02-01) |
| 2 | Integration | Pending |
| 3 | Polish | Pending |
`;

// ---------------------------------------------------------------------------
// Temp dir management
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "forge-merge-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writePlanningFile(baseDir: string, filename: string, content: string): string {
  const planningDir = join(baseDir, ".planning");
  mkdirSync(planningDir, { recursive: true });
  const filePath = join(planningDir, filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// updateRoadmapMilestoneStatus
// ---------------------------------------------------------------------------

describe("updateRoadmapMilestoneStatus", () => {
  it("updates the status of a matching milestone row", () => {
    const roadmapPath = writePlanningFile(tempDir, "ROADMAP.md", SAMPLE_ROADMAP);

    const result = updateRoadmapMilestoneStatus(roadmapPath, 2, "Complete (2026-02-15)");

    expect(result).toBe(true);

    const updated = readFileSync(roadmapPath, "utf-8");
    expect(updated).toContain("Complete (2026-02-15)");
    // Milestone 1 should still have its original status
    expect(updated).toContain("Complete (2026-02-01)");
  });

  it("returns false when milestone number is not found", () => {
    const roadmapPath = writePlanningFile(tempDir, "ROADMAP.md", SAMPLE_ROADMAP);

    const result = updateRoadmapMilestoneStatus(roadmapPath, 99, "Complete (2026-02-15)");

    expect(result).toBe(false);

    // File should be unchanged
    const content = readFileSync(roadmapPath, "utf-8");
    expect(content).toBe(SAMPLE_ROADMAP);
  });

  it("overwrites already-complete milestones (last completer wins)", () => {
    const roadmapPath = writePlanningFile(tempDir, "ROADMAP.md", SAMPLE_ROADMAP);

    // Milestone 1 is already Complete (2026-02-01)
    const result = updateRoadmapMilestoneStatus(roadmapPath, 1, "Complete (2026-02-15)");

    expect(result).toBe(true);

    const updated = readFileSync(roadmapPath, "utf-8");
    expect(updated).toContain("Complete (2026-02-15)");
    // Old completion date should be gone for milestone 1
    // (milestone 1 row no longer has old date)
  });

  it("preserves table structure and other rows", () => {
    const roadmapPath = writePlanningFile(tempDir, "ROADMAP.md", SAMPLE_ROADMAP);

    updateRoadmapMilestoneStatus(roadmapPath, 3, "In Progress");

    const updated = readFileSync(roadmapPath, "utf-8");
    // Milestone 1 and 2 should be unchanged
    expect(updated).toContain("| 1 | Foundation |");
    expect(updated).toContain("| 2 | Integration |");
    // Milestone 3 should be updated
    expect(updated).toContain("In Progress");
  });

  it("does not modify header or separator rows", () => {
    const roadmapPath = writePlanningFile(tempDir, "ROADMAP.md", SAMPLE_ROADMAP);

    updateRoadmapMilestoneStatus(roadmapPath, 2, "Complete (2026-02-15)");

    const updated = readFileSync(roadmapPath, "utf-8");
    // Header row should still exist
    expect(updated).toContain("| Milestone | Name | Status |");
    // Separator should still exist
    expect(updated).toContain("|-----------|------|--------|");
  });
});

// ---------------------------------------------------------------------------
// updateStateMilestoneRow
// ---------------------------------------------------------------------------

describe("updateStateMilestoneRow", () => {
  it("updates milestone status in table", () => {
    const statePath = writePlanningFile(tempDir, "STATE.md", SAMPLE_STATE);

    const result = updateStateMilestoneRow(statePath, 2, "Complete (2026-02-15)");

    expect(result).toBe(true);

    const updated = readFileSync(statePath, "utf-8");
    // Milestone 2 should now show the new status
    const lines = updated.split("\n");
    const m2Line = lines.find((l) => l.includes("| 2 |"));
    expect(m2Line).toContain("Complete (2026-02-15)");
  });

  it("updates Last Session date when status contains a date", () => {
    const statePath = writePlanningFile(tempDir, "STATE.md", SAMPLE_STATE);

    updateStateMilestoneRow(statePath, 2, "Complete (2026-02-15)");

    const updated = readFileSync(statePath, "utf-8");
    expect(updated).toContain("**Last Session:** 2026-02-15");
  });

  it("returns false when milestone is not found", () => {
    const statePath = writePlanningFile(tempDir, "STATE.md", SAMPLE_STATE);

    const result = updateStateMilestoneRow(statePath, 99, "Complete (2026-02-15)");

    expect(result).toBe(false);

    // File should be unchanged
    const content = readFileSync(statePath, "utf-8");
    expect(content).toBe(SAMPLE_STATE);
  });

  it("preserves other milestone rows", () => {
    const statePath = writePlanningFile(tempDir, "STATE.md", SAMPLE_STATE);

    updateStateMilestoneRow(statePath, 2, "Complete (2026-02-15)");

    const updated = readFileSync(statePath, "utf-8");
    // Milestone 1 should be unchanged
    const lines = updated.split("\n");
    const m1Line = lines.find((l) => l.includes("| 1 |"));
    expect(m1Line).toContain("Complete (2026-02-01)");
    // Milestone 3 should be unchanged
    const m3Line = lines.find((l) => l.includes("| 3 |"));
    expect(m3Line).toContain("Pending");
  });

  it("does not update Last Session when status has no date", () => {
    const statePath = writePlanningFile(tempDir, "STATE.md", SAMPLE_STATE);

    updateStateMilestoneRow(statePath, 3, "In Progress");

    const updated = readFileSync(statePath, "utf-8");
    // Last Session should remain at original date
    expect(updated).toContain("**Last Session:** 2026-02-10");
  });
});

// ---------------------------------------------------------------------------
// mergeSessionState
// ---------------------------------------------------------------------------

describe("mergeSessionState", () => {
  let mainDir: string;
  let worktreeDir: string;

  beforeEach(() => {
    mainDir = join(tempDir, "main-repo");
    worktreeDir = join(tempDir, "worktree");
    mkdirSync(mainDir, { recursive: true });
    mkdirSync(worktreeDir, { recursive: true });
  });

  it("updates both STATE.md and ROADMAP.md in main repo", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeDir, "ROADMAP.md", SAMPLE_ROADMAP);

    const result = mergeSessionState(mainDir, worktreeDir, 2, "2026-02-15");

    expect(result.stateUpdated).toBe(true);
    expect(result.roadmapUpdated).toBe(true);
    expect(result.warnings).toHaveLength(0);

    // Verify STATE.md was updated
    const state = readFileSync(join(mainDir, ".planning", "STATE.md"), "utf-8");
    expect(state).toContain("Complete (2026-02-15)");

    // Verify ROADMAP.md was updated
    const roadmap = readFileSync(join(mainDir, ".planning", "ROADMAP.md"), "utf-8");
    const lines = roadmap.split("\n");
    const m2Line = lines.find((l) => l.includes("| 2 |"));
    expect(m2Line).toContain("Complete (2026-02-15)");
  });

  it("warns when worktree STATE.md is missing", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeDir, "ROADMAP.md", SAMPLE_ROADMAP);
    // No STATE.md in worktree

    const result = mergeSessionState(mainDir, worktreeDir, 2, "2026-02-15");

    expect(result.warnings.some((w) => w.includes("Worktree STATE.md not found"))).toBe(true);
    // Main repo should still be updated since main files exist
    expect(result.stateUpdated).toBe(true);
  });

  it("warns when worktree ROADMAP.md is missing", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeDir, "STATE.md", SAMPLE_STATE);
    // No ROADMAP.md in worktree

    const result = mergeSessionState(mainDir, worktreeDir, 2, "2026-02-15");

    expect(result.warnings.some((w) => w.includes("Worktree ROADMAP.md not found"))).toBe(true);
    // Main repo should still be updated
    expect(result.roadmapUpdated).toBe(true);
  });

  it("warns when main STATE.md is missing", () => {
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeDir, "ROADMAP.md", SAMPLE_ROADMAP);
    // No STATE.md in main

    const result = mergeSessionState(mainDir, worktreeDir, 2, "2026-02-15");

    expect(result.stateUpdated).toBe(false);
    expect(result.warnings.some((w) => w.includes("Main repo STATE.md not found"))).toBe(true);
  });

  it("warns when main ROADMAP.md is missing", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeDir, "ROADMAP.md", SAMPLE_ROADMAP);
    // No ROADMAP.md in main

    const result = mergeSessionState(mainDir, worktreeDir, 2, "2026-02-15");

    expect(result.roadmapUpdated).toBe(false);
    expect(result.warnings.some((w) => w.includes("Main repo ROADMAP.md not found"))).toBe(true);
  });

  it("warns when milestone is not found in main files", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeDir, "ROADMAP.md", SAMPLE_ROADMAP);

    const result = mergeSessionState(mainDir, worktreeDir, 99, "2026-02-15");

    expect(result.stateUpdated).toBe(false);
    expect(result.roadmapUpdated).toBe(false);
    expect(result.warnings.some((w) => w.includes("Milestone 99 row not found"))).toBe(true);
  });

  it("handles completely missing planning directories gracefully", () => {
    // No planning dirs at all
    const result = mergeSessionState(mainDir, worktreeDir, 2, "2026-02-15");

    expect(result.stateUpdated).toBe(false);
    expect(result.roadmapUpdated).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("uses correct completion date format in status", () => {
    writePlanningFile(mainDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(mainDir, "ROADMAP.md", SAMPLE_ROADMAP);
    writePlanningFile(worktreeDir, "STATE.md", SAMPLE_STATE);
    writePlanningFile(worktreeDir, "ROADMAP.md", SAMPLE_ROADMAP);

    mergeSessionState(mainDir, worktreeDir, 3, "2026-03-01");

    const state = readFileSync(join(mainDir, ".planning", "STATE.md"), "utf-8");
    const roadmap = readFileSync(join(mainDir, ".planning", "ROADMAP.md"), "utf-8");

    expect(state).toContain("Complete (2026-03-01)");
    expect(roadmap).toContain("Complete (2026-03-01)");
  });
});
