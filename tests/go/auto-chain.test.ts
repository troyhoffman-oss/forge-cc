import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countPendingMilestones, findNextPendingMilestone } from "../../src/go/auto-chain.js";

// These are re-exports from prd-status.js — test with real filesystem
describe("countPendingMilestones (via auto-chain re-export)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "forge-autochain-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when no status directory exists", async () => {
    expect(await countPendingMilestones(tmpDir)).toBe(0);
  });

  it("counts pending milestones for a specific slug", async () => {
    const statusDir = join(tmpDir, ".planning", "status");
    await mkdir(statusDir, { recursive: true });
    await writeFile(
      join(statusDir, "test.json"),
      JSON.stringify({
        project: "Test",
        slug: "test",
        branch: "feat/test",
        createdAt: "2026-01-01",
        milestones: {
          "1": { status: "complete", date: "2026-01-01" },
          "2": { status: "pending" },
          "3": { status: "pending" },
        },
      }),
    );
    expect(await countPendingMilestones(tmpDir, "test")).toBe(2);
  });

  it("counts across all PRDs when no slug given", async () => {
    const statusDir = join(tmpDir, ".planning", "status");
    await mkdir(statusDir, { recursive: true });
    await writeFile(
      join(statusDir, "a.json"),
      JSON.stringify({
        project: "A",
        slug: "a",
        branch: "feat/a",
        createdAt: "2026-01-01",
        milestones: { "1": { status: "pending" } },
      }),
    );
    await writeFile(
      join(statusDir, "b.json"),
      JSON.stringify({
        project: "B",
        slug: "b",
        branch: "feat/b",
        createdAt: "2026-01-01",
        milestones: { "1": { status: "pending" }, "2": { status: "pending" } },
      }),
    );
    expect(await countPendingMilestones(tmpDir)).toBe(3);
  });
});

describe("findNextPendingMilestone (via auto-chain re-export)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "forge-autochain-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when PRD does not exist", async () => {
    expect(await findNextPendingMilestone(tmpDir, "missing")).toBeNull();
  });

  it("returns the first pending milestone", async () => {
    const statusDir = join(tmpDir, ".planning", "status");
    await mkdir(statusDir, { recursive: true });
    await writeFile(
      join(statusDir, "test.json"),
      JSON.stringify({
        project: "Test",
        slug: "test",
        branch: "feat/test",
        createdAt: "2026-01-01",
        milestones: {
          "1": { status: "complete", date: "2026-01-01" },
          "2": { status: "pending" },
          "3": { status: "pending" },
        },
      }),
    );
    const result = await findNextPendingMilestone(tmpDir, "test");
    expect(result).toEqual({ number: 2, status: { status: "pending" } });
  });
});

import { afterEach } from "vitest";
