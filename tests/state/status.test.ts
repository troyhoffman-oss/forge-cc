import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  readStatus,
  writeStatus,
  updateMilestoneStatus,
  discoverStatuses,
  findNextPending,
  prdStatusSchema,
} from "../../src/state/status.js";
import type { PRDStatus } from "../../src/types.js";

function tempDir() {
  return join(tmpdir(), `forge-test-${randomUUID()}`);
}

function makePRDStatus(overrides: Partial<PRDStatus> = {}): PRDStatus {
  return {
    project: "Test Project",
    slug: "test-project",
    branch: "feat/test",
    createdAt: "2026-01-01T00:00:00.000Z",
    milestones: {
      "1": { status: "complete", completedAt: "2026-01-02T00:00:00.000Z" },
      "2": { status: "in_progress" },
      "3": { status: "pending" },
    },
    ...overrides,
  };
}

describe("status", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  describe("reader", () => {
    it("loads valid JSON and validates with Zod schema", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const statusDir = join(dir, ".planning", "status");
      await mkdir(statusDir, { recursive: true });

      const data = makePRDStatus();
      await writeFile(
        join(statusDir, "test-project.json"),
        JSON.stringify(data),
        "utf-8",
      );

      const result = await readStatus(dir, "test-project");
      expect(result.project).toBe("Test Project");
      expect(result.slug).toBe("test-project");
      expect(result.milestones["1"].status).toBe("complete");
      expect(result.milestones["2"].status).toBe("in_progress");
      expect(result.milestones["3"].status).toBe("pending");
    });

    it("rejects malformed JSON", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const statusDir = join(dir, ".planning", "status");
      await mkdir(statusDir, { recursive: true });

      await writeFile(
        join(statusDir, "bad.json"),
        "{not valid json",
        "utf-8",
      );

      await expect(readStatus(dir, "bad")).rejects.toThrow();
    });

    it("rejects invalid schema (missing required fields)", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const statusDir = join(dir, ".planning", "status");
      await mkdir(statusDir, { recursive: true });

      await writeFile(
        join(statusDir, "incomplete.json"),
        JSON.stringify({ project: "Missing fields" }),
        "utf-8",
      );

      await expect(readStatus(dir, "incomplete")).rejects.toThrow();
    });

    it("Zod schema validates PRDStatus shape", () => {
      const valid = makePRDStatus();
      expect(() => prdStatusSchema.parse(valid)).not.toThrow();

      const invalid = { project: 123 };
      expect(() => prdStatusSchema.parse(invalid)).toThrow();
    });
  });

  describe("writer", () => {
    it("writes status atomically (temp file + rename)", async () => {
      const dir = tempDir();
      dirs.push(dir);

      const data = makePRDStatus();
      await writeStatus(dir, "test-project", data);

      // Verify the file exists at the expected path
      const statusDir = join(dir, ".planning", "status");
      const files = await readdir(statusDir);
      expect(files).toContain("test-project.json");

      // No temp files should remain
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);

      // Verify the content is correct
      const raw = await readFile(
        join(statusDir, "test-project.json"),
        "utf-8",
      );
      const parsed = JSON.parse(raw) as PRDStatus;
      expect(parsed.project).toBe("Test Project");
      expect(parsed.milestones["2"].status).toBe("in_progress");
    });

    it("updateMilestoneStatus reads, updates, and writes back", async () => {
      const dir = tempDir();
      dirs.push(dir);

      // Write initial status
      await writeStatus(dir, "test-project", makePRDStatus());

      // Update milestone 3 from pending to in_progress
      const updated = await updateMilestoneStatus(
        dir,
        "test-project",
        "3",
        "in_progress",
      );
      expect(updated.milestones["3"].status).toBe("in_progress");

      // Verify persistence
      const reloaded = await readStatus(dir, "test-project");
      expect(reloaded.milestones["3"].status).toBe("in_progress");
    });

    it("updateMilestoneStatus sets completedAt when marking complete", async () => {
      const dir = tempDir();
      dirs.push(dir);

      await writeStatus(dir, "test-project", makePRDStatus());

      const updated = await updateMilestoneStatus(
        dir,
        "test-project",
        "2",
        "complete",
      );
      expect(updated.milestones["2"].status).toBe("complete");
      expect(updated.milestones["2"].completedAt).toBeDefined();
    });
  });

  describe("discovery", () => {
    it("finds all status files and identifies pending milestones", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const statusDir = join(dir, ".planning", "status");
      await mkdir(statusDir, { recursive: true });

      // Write two valid status files
      const prd1 = makePRDStatus({ slug: "project-a", project: "Project A" });
      const prd2 = makePRDStatus({
        slug: "project-b",
        project: "Project B",
        milestones: {
          "1": { status: "complete" },
          "2": { status: "pending" },
        },
      });

      await writeFile(
        join(statusDir, "project-a.json"),
        JSON.stringify(prd1),
        "utf-8",
      );
      await writeFile(
        join(statusDir, "project-b.json"),
        JSON.stringify(prd2),
        "utf-8",
      );
      // Write an invalid file that should be skipped
      await writeFile(
        join(statusDir, "invalid.json"),
        "{bad json",
        "utf-8",
      );

      const statuses = await discoverStatuses(dir);
      expect(statuses).toHaveLength(2);

      const slugs = statuses.map((s) => s.slug).sort();
      expect(slugs).toEqual(["project-a", "project-b"]);

      // Find next pending milestones
      const pending = findNextPending(statuses);
      expect(pending).toHaveLength(2);

      const pendingA = pending.find((p) => p.slug === "project-a");
      expect(pendingA).toBeDefined();
      expect(pendingA!.milestone).toBe("3");

      const pendingB = pending.find((p) => p.slug === "project-b");
      expect(pendingB).toBeDefined();
      expect(pendingB!.milestone).toBe("2");
    });

    it("returns empty array when status directory does not exist", async () => {
      const dir = tempDir();
      dirs.push(dir);
      await mkdir(dir, { recursive: true });

      const statuses = await discoverStatuses(dir);
      expect(statuses).toHaveLength(0);
    });

    it("findNextPending skips PRDs with no pending milestones", () => {
      const allComplete: PRDStatus = makePRDStatus({
        slug: "done-project",
        milestones: {
          "1": { status: "complete" },
          "2": { status: "complete" },
        },
      });

      const pending = findNextPending([allComplete]);
      expect(pending).toHaveLength(0);
    });
  });
});
