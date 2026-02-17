import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readPRDStatus,
  writePRDStatus,
  updateMilestoneStatus,
  discoverPRDs,
  findNextPendingMilestone,
} from "../../src/state/prd-status.js";
import type { PRDStatus } from "../../src/state/prd-status.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "forge-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeStatus(overrides?: Partial<PRDStatus>): PRDStatus {
  return {
    project: "Test Project",
    slug: "test-project",
    branch: "feat/test",
    createdAt: "2026-01-01",
    milestones: {
      "1": { status: "complete", date: "2026-01-01" },
      "2": { status: "in_progress" },
      "3": { status: "pending" },
    },
    ...overrides,
  };
}

async function writeStatusFile(
  projectDir: string,
  slug: string,
  content: string,
): Promise<void> {
  const dir = join(projectDir, ".planning", "status");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.json`), content, "utf-8");
}

// ---------------------------------------------------------------------------
// readPRDStatus
// ---------------------------------------------------------------------------

describe("readPRDStatus", () => {
  it("returns null for missing file", async () => {
    const result = await readPRDStatus(tmpDir, "nonexistent");
    expect(result).toBeNull();
  });

  it("reads and validates a correct status file", async () => {
    const status = makeStatus();
    await writeStatusFile(tmpDir, "test-project", JSON.stringify(status));
    const result = await readPRDStatus(tmpDir, "test-project");
    expect(result).toEqual(status);
  });
});

// ---------------------------------------------------------------------------
// writePRDStatus
// ---------------------------------------------------------------------------

describe("writePRDStatus", () => {
  it("creates the status directory if it doesn't exist", async () => {
    const status = makeStatus();
    await writePRDStatus(tmpDir, "test-project", status);
    const result = await readPRDStatus(tmpDir, "test-project");
    expect(result).toEqual(status);
  });

  it("writes valid JSON that can be read back", async () => {
    const status = makeStatus({ project: "Roundtrip Test" });
    await writePRDStatus(tmpDir, "roundtrip", status);
    const result = await readPRDStatus(tmpDir, "roundtrip");
    expect(result).toEqual(status);
  });
});

// ---------------------------------------------------------------------------
// updateMilestoneStatus
// ---------------------------------------------------------------------------

describe("updateMilestoneStatus", () => {
  it("updates a milestone from pending to in_progress", async () => {
    const status = makeStatus();
    await writePRDStatus(tmpDir, "test-project", status);

    await updateMilestoneStatus(tmpDir, "test-project", 3, "in_progress");

    const result = await readPRDStatus(tmpDir, "test-project");
    expect(result?.milestones["3"].status).toBe("in_progress");
  });

  it("updates a milestone to complete with auto-generated date", async () => {
    const status = makeStatus();
    await writePRDStatus(tmpDir, "test-project", status);

    await updateMilestoneStatus(tmpDir, "test-project", 2, "complete");

    const result = await readPRDStatus(tmpDir, "test-project");
    expect(result?.milestones["2"].status).toBe("complete");
    expect(result?.milestones["2"].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("throws when PRD status file doesn't exist", async () => {
    await expect(
      updateMilestoneStatus(tmpDir, "nonexistent", 1, "complete"),
    ).rejects.toThrow("PRD status file not found for slug: nonexistent");
  });
});

// ---------------------------------------------------------------------------
// discoverPRDs
// ---------------------------------------------------------------------------

describe("discoverPRDs", () => {
  it("returns empty array when no status directory exists", async () => {
    const result = await discoverPRDs(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns all valid PRD status files, sorted by slug", async () => {
    await writePRDStatus(tmpDir, "zebra", makeStatus({ slug: "zebra" }));
    await writePRDStatus(tmpDir, "alpha", makeStatus({ slug: "alpha" }));
    await writePRDStatus(tmpDir, "middle", makeStatus({ slug: "middle" }));

    const result = await discoverPRDs(tmpDir);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.slug)).toEqual(["alpha", "middle", "zebra"]);
  });
});

// ---------------------------------------------------------------------------
// findNextPendingMilestone
// ---------------------------------------------------------------------------

describe("findNextPendingMilestone", () => {
  it("returns null for missing PRD", async () => {
    const result = await findNextPendingMilestone(tmpDir, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns the lowest-numbered pending milestone", async () => {
    const status = makeStatus({
      milestones: {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "pending" },
        "3": { status: "pending" },
      },
    });
    await writePRDStatus(tmpDir, "test-project", status);

    const result = await findNextPendingMilestone(tmpDir, "test-project");
    expect(result).toEqual({ number: 2, status: { status: "pending" } });
  });

  it("returns null when all milestones are complete", async () => {
    const status = makeStatus({
      milestones: {
        "1": { status: "complete", date: "2026-01-01" },
        "2": { status: "complete", date: "2026-01-02" },
      },
    });
    await writePRDStatus(tmpDir, "test-project", status);

    const result = await findNextPendingMilestone(tmpDir, "test-project");
    expect(result).toBeNull();
  });
});
