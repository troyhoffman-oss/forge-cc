import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse as yamlParse } from "yaml";

import {
  writeIndex,
  writeRequirement,
  writeOverview,
  initGraph,
  updateRequirementStatus,
  batchUpdateStatus,
  addDiscoveredRequirement,
} from "../../src/graph/writer.js";
import { loadIndex } from "../../src/graph/reader.js";
import type {
  GraphIndex,
  Requirement,
  RequirementMeta,
  RequirementStatus,
} from "../../src/graph/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  return join(tmpdir(), `forge-test-${randomUUID()}`);
}

function makeIndex(): GraphIndex {
  return {
    project: "Test Project",
    slug: "test-project",
    branch: "feat/test",
    createdAt: "2026-02-21",
    groups: {
      core: { name: "Core", order: 1 },
    },
    requirements: {
      "req-001": {
        group: "core",
        status: "pending",
        dependsOn: [],
      },
      "req-002": {
        group: "core",
        status: "pending",
        dependsOn: ["req-001"],
      },
    },
  };
}

function makeRequirement(id = "req-001"): Requirement {
  return {
    id,
    title: "Setup Project",
    dependsOn: [],
    files: { creates: ["src/index.ts"], modifies: [] },
    acceptance: ["Project compiles", "Entry point exists"],
    body: "## Context\nBootstrap the project.\n\n## Technical Approach\nUse TypeScript.",
  };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("graph writer", () => {
  const slug = "test-project";

  describe("writeIndex", () => {
    it("creates directory and writes YAML file", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();

      await writeIndex(dir, slug, index);

      const filePath = join(dir, ".planning", "graph", slug, "_index.yaml");
      const raw = await readFile(filePath, "utf-8");
      const parsed = yamlParse(raw);

      expect(parsed.project).toBe("Test Project");
      expect(parsed.slug).toBe("test-project");
      expect(parsed.branch).toBe("feat/test");
      expect(parsed.requirements["req-001"].status).toBe("pending");
      expect(parsed.requirements["req-002"].dependsOn).toEqual(["req-001"]);
    });

    it("atomic write — no temp files remain after write", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();

      await writeIndex(dir, slug, index);

      const graphPath = join(dir, ".planning", "graph", slug);
      const entries = await readdir(graphPath);
      const tmpFiles = entries.filter((e) => e.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("writeRequirement", () => {
    it("creates requirements directory and file", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const req = makeRequirement();

      await writeRequirement(dir, slug, req);

      const reqDir = join(dir, ".planning", "graph", slug, "requirements");
      const entries = await readdir(reqDir);
      expect(entries.length).toBe(1);
      expect(entries[0]).toMatch(/^req-001-.*\.md$/);
    });

    it("serializes frontmatter + body correctly", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const req = makeRequirement();

      await writeRequirement(dir, slug, req);

      const reqDir = join(dir, ".planning", "graph", slug, "requirements");
      const entries = await readdir(reqDir);
      const raw = await readFile(join(reqDir, entries[0]), "utf-8");

      // Verify it starts with YAML frontmatter
      expect(raw.startsWith("---\n")).toBe(true);

      // Parse frontmatter
      const endIdx = raw.indexOf("\n---\n", 4);
      expect(endIdx).toBeGreaterThan(0);
      const yamlStr = raw.slice(4, endIdx);
      const frontmatter = yamlParse(yamlStr);

      expect(frontmatter.id).toBe("req-001");
      expect(frontmatter.title).toBe("Setup Project");
      expect(frontmatter.dependsOn).toEqual([]);
      expect(frontmatter.files.creates).toEqual(["src/index.ts"]);
      expect(frontmatter.acceptance).toEqual(["Project compiles", "Entry point exists"]);

      // Verify body comes after frontmatter
      const body = raw.slice(endIdx + 5).trim();
      expect(body).toContain("## Context");
      expect(body).toContain("## Technical Approach");
    });
  });

  describe("writeOverview", () => {
    it("writes content to overview.md", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const content = "# Project Overview\n\nThis is a test project.";

      await writeOverview(dir, slug, content);

      const filePath = join(dir, ".planning", "graph", slug, "overview.md");
      const raw = await readFile(filePath, "utf-8");
      expect(raw).toBe(content);
    });
  });

  describe("initGraph", () => {
    it("creates full directory structure", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      const overview = "# Overview\n\nTest.";

      await initGraph(dir, slug, index, overview);

      // Check directory structure
      const graphPath = join(dir, ".planning", "graph", slug);
      const graphStat = await stat(graphPath);
      expect(graphStat.isDirectory()).toBe(true);

      const reqDir = join(graphPath, "requirements");
      const reqStat = await stat(reqDir);
      expect(reqStat.isDirectory()).toBe(true);

      // Check _index.yaml exists and is valid
      const indexRaw = await readFile(join(graphPath, "_index.yaml"), "utf-8");
      const parsed = yamlParse(indexRaw);
      expect(parsed.project).toBe("Test Project");

      // Check overview.md exists
      const overviewRaw = await readFile(join(graphPath, "overview.md"), "utf-8");
      expect(overviewRaw).toBe(overview);
    });

    it("throws if directory already exists", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      const overview = "# Overview";

      await initGraph(dir, slug, index, overview);

      await expect(initGraph(dir, slug, index, overview)).rejects.toThrow(
        /Graph directory already exists/,
      );
    });
  });

  describe("updateRequirementStatus", () => {
    it("reads, updates, and writes back", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      await writeIndex(dir, slug, index);

      const updated = await updateRequirementStatus(dir, slug, "req-001", "in_progress");

      expect(updated.requirements["req-001"].status).toBe("in_progress");

      // Verify it was persisted
      const filePath = join(dir, ".planning", "graph", slug, "_index.yaml");
      const raw = await readFile(filePath, "utf-8");
      const parsed = yamlParse(raw);
      expect(parsed.requirements["req-001"].status).toBe("in_progress");
    });

    it("sets completedAt when marking complete", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      await writeIndex(dir, slug, index);

      const updated = await updateRequirementStatus(dir, slug, "req-001", "complete");

      expect(updated.requirements["req-001"].status).toBe("complete");
      expect(updated.requirements["req-001"].completedAt).toBeDefined();
      // Verify it's a valid ISO timestamp
      const ts = new Date(updated.requirements["req-001"].completedAt!);
      expect(ts.getTime()).not.toBeNaN();
    });

    it("throws on unknown requirement ID", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      await writeIndex(dir, slug, index);

      await expect(
        updateRequirementStatus(dir, slug, "req-999", "complete"),
      ).rejects.toThrow(/Requirement not found in index: req-999/);
    });
  });

  describe("batchUpdateStatus", () => {
    it("updates multiple requirements in single write", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      await writeIndex(dir, slug, index);

      const updated = await batchUpdateStatus(dir, slug, [
        { requirementId: "req-001", status: "complete" },
        { requirementId: "req-002", status: "in_progress" },
      ]);

      expect(updated.requirements["req-001"].status).toBe("complete");
      expect(updated.requirements["req-001"].completedAt).toBeDefined();
      expect(updated.requirements["req-002"].status).toBe("in_progress");

      // Verify persistence
      const filePath = join(dir, ".planning", "graph", slug, "_index.yaml");
      const raw = await readFile(filePath, "utf-8");
      const parsed = yamlParse(raw);
      expect(parsed.requirements["req-001"].status).toBe("complete");
      expect(parsed.requirements["req-002"].status).toBe("in_progress");
    });
  });

  describe("addDiscoveredRequirement", () => {
    it("writes index first, then requirement file (verify both exist)", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      await writeIndex(dir, slug, index);

      const newReq = makeRequirement("req-003");
      newReq.title = "New Discovery";

      const meta: Omit<RequirementMeta, "status"> = {
        group: "core",
        dependsOn: [],
        discoveredBy: "test-agent",
      };

      const updated = await addDiscoveredRequirement(dir, slug, newReq, meta);

      // Verify index was updated
      expect(updated.requirements["req-003"]).toBeDefined();
      expect(updated.requirements["req-003"].status).toBe("discovered");
      expect(updated.requirements["req-003"].discoveredBy).toBe("test-agent");

      // Verify requirement file was written
      const reqDir = join(dir, ".planning", "graph", slug, "requirements");
      const entries = await readdir(reqDir);
      const reqFile = entries.find((e) => e.startsWith("req-003-"));
      expect(reqFile).toBeDefined();

      // Verify file content
      const raw = await readFile(join(reqDir, reqFile!), "utf-8");
      expect(raw.startsWith("---\n")).toBe(true);
      expect(raw).toContain("req-003");
    });

    it("throws on duplicate ID", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();
      await writeIndex(dir, slug, index);

      const dupReq = makeRequirement("req-001");
      const meta: Omit<RequirementMeta, "status"> = {
        group: "core",
        dependsOn: [],
      };

      await expect(
        addDiscoveredRequirement(dir, slug, dupReq, meta),
      ).rejects.toThrow(/Requirement already exists in index: req-001/);
    });
  });

  describe("round-trip", () => {
    it("writeIndex then loadIndex returns identical data", async () => {
      const dir = tempDir();
      dirs.push(dir);
      const index = makeIndex();

      await writeIndex(dir, slug, index);
      const loaded = await loadIndex(dir, slug);

      expect(loaded.project).toBe(index.project);
      expect(loaded.slug).toBe(index.slug);
      expect(loaded.branch).toBe(index.branch);
      expect(loaded.createdAt).toBe(index.createdAt);
      expect(loaded.groups.core.name).toBe(index.groups.core.name);
      expect(loaded.groups.core.order).toBe(index.groups.core.order);

      // Check requirements match (Zod schema adds defaults like priority: 0)
      expect(loaded.requirements["req-001"].group).toBe("core");
      expect(loaded.requirements["req-001"].status).toBe("pending");
      expect(loaded.requirements["req-001"].dependsOn).toEqual([]);
      expect(loaded.requirements["req-002"].group).toBe("core");
      expect(loaded.requirements["req-002"].status).toBe("pending");
      expect(loaded.requirements["req-002"].dependsOn).toEqual(["req-001"]);
    });
  });
});
