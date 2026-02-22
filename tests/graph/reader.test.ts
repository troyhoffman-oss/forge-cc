import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  loadGraph,
  loadIndex,
  loadRequirement,
  loadRequirements,
  loadOverview,
  discoverGraphs,
} from "../../src/graph/reader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_DIR = join(__dirname, "..", "fixtures", "sample-graph");
const SLUG = "sample-project";

/** Create a temp dir with the fixture copied into .planning/graph/{slug}/ */
async function createTempGraph(slug = SLUG): Promise<string> {
  const tempDir = join(tmpdir(), `forge-test-${randomUUID()}`);
  const graphTarget = join(tempDir, ".planning", "graph", slug);
  await mkdir(graphTarget, { recursive: true });
  await cp(FIXTURE_DIR, graphTarget, { recursive: true });
  return tempDir;
}

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("graph reader", () => {
  describe("loadGraph", () => {
    it("returns full graph with index, overview, and all 5 requirements", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const graph = await loadGraph(tempDir, SLUG);

      // Index
      expect(graph.index.project).toBe("Sample Project");
      expect(graph.index.slug).toBe("sample-project");
      expect(graph.index.branch).toBe("feat/sample-project");
      expect(Object.keys(graph.index.groups)).toHaveLength(2);
      expect(Object.keys(graph.index.requirements)).toHaveLength(5);

      // Overview
      expect(graph.overview).toContain("Sample Project");
      expect(graph.overview).toContain("two groups");

      // Requirements
      expect(graph.requirements.size).toBe(5);
      expect(graph.requirements.has("req-001")).toBe(true);
      expect(graph.requirements.has("req-002")).toBe(true);
      expect(graph.requirements.has("req-003")).toBe(true);
      expect(graph.requirements.has("req-004")).toBe(true);
      expect(graph.requirements.has("req-005")).toBe(true);
    });

    it("throws on missing index file", async () => {
      const tempDir = join(tmpdir(), `forge-test-${randomUUID()}`);
      const emptyGraph = join(tempDir, ".planning", "graph", "no-index");
      await mkdir(emptyGraph, { recursive: true });
      dirs.push(tempDir);

      await expect(loadGraph(tempDir, "no-index")).rejects.toThrow();
    });

    it("throws on invalid index schema", async () => {
      const tempDir = join(tmpdir(), `forge-test-${randomUUID()}`);
      const badGraph = join(tempDir, ".planning", "graph", "bad-schema");
      await mkdir(badGraph, { recursive: true });
      await writeFile(
        join(badGraph, "_index.yaml"),
        "invalid: true\nno_project: here\n",
      );
      dirs.push(tempDir);

      await expect(loadGraph(tempDir, "bad-schema")).rejects.toThrow();
    });
  });

  describe("loadIndex", () => {
    it("returns parsed and validated GraphIndex with correct structure", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const index = await loadIndex(tempDir, SLUG);

      expect(index.project).toBe("Sample Project");
      expect(index.slug).toBe("sample-project");
      expect(index.branch).toBe("feat/sample-project");
      expect(index.createdAt).toBe("2026-02-21");

      // Linear config
      expect(index.linear).toBeDefined();
      expect(index.linear!.projectId).toBe("test-project-id");
      expect(index.linear!.teamId).toBe("test-team-id");

      // Groups
      expect(index.groups.foundation).toBeDefined();
      expect(index.groups.foundation.name).toBe("Foundation");
      expect(index.groups.foundation.order).toBe(1);
      expect(index.groups.features).toBeDefined();
      expect(index.groups.features.name).toBe("Features");
      expect(index.groups.features.order).toBe(2);
      expect(index.groups.features.dependsOn).toContain("foundation");

      // Requirements metadata
      expect(Object.keys(index.requirements)).toHaveLength(5);
      expect(index.requirements["req-001"].status).toBe("complete");
      expect(index.requirements["req-001"].group).toBe("foundation");
      expect(index.requirements["req-001"].completedAt).toBe("2026-02-20T10:00:00Z");
      expect(index.requirements["req-002"].status).toBe("in_progress");
      expect(index.requirements["req-002"].dependsOn).toContain("req-001");
      expect(index.requirements["req-003"].status).toBe("pending");
      expect(index.requirements["req-003"].dependsOn).toEqual(
        expect.arrayContaining(["req-001", "req-002"]),
      );
      expect(index.requirements["req-004"].dependsOn).toContain("req-001");
      expect(index.requirements["req-005"].dependsOn).toEqual([]);
    });
  });

  describe("loadRequirement", () => {
    it("returns requirement by ID", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const req = await loadRequirement(tempDir, SLUG, "req-001");

      expect(req).not.toBeNull();
      expect(req!.id).toBe("req-001");
      expect(req!.title).toBe("Setup Project");
      expect(req!.body).toContain("Bootstrap the project");
    });

    it("returns null for unknown ID", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const req = await loadRequirement(tempDir, SLUG, "req-999");

      expect(req).toBeNull();
    });
  });

  describe("loadRequirements", () => {
    it("returns Map of multiple requirements for requested IDs", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const reqs = await loadRequirements(tempDir, SLUG, [
        "req-001",
        "req-003",
        "req-005",
      ]);

      expect(reqs.size).toBe(3);
      expect(reqs.has("req-001")).toBe(true);
      expect(reqs.has("req-003")).toBe(true);
      expect(reqs.has("req-005")).toBe(true);
      expect(reqs.get("req-001")!.title).toBe("Setup Project");
      expect(reqs.get("req-003")!.title).toBe("API Endpoints");
      expect(reqs.get("req-005")!.title).toBe("Testing Infrastructure");
    });
  });

  describe("loadOverview", () => {
    it("returns overview content as string", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const overview = await loadOverview(tempDir, SLUG);

      expect(overview).toContain("# Sample Project");
      expect(overview).toContain("sample project used for testing the graph module");
      expect(overview).toContain("two groups (foundation and features)");
      expect(overview).toContain("five requirements");
    });
  });

  describe("discoverGraphs", () => {
    it("finds valid graph directory", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const slugs = await discoverGraphs(tempDir);

      expect(slugs).toContain("sample-project");
      expect(slugs).toHaveLength(1);
    });

    it("skips directories without valid index", async () => {
      const tempDir = await createTempGraph();
      // Add an invalid graph dir alongside the valid one
      const invalidDir = join(
        tempDir,
        ".planning",
        "graph",
        "invalid-project",
      );
      await mkdir(invalidDir, { recursive: true });
      await writeFile(join(invalidDir, "_index.yaml"), "not_valid: true\n");
      dirs.push(tempDir);

      const slugs = await discoverGraphs(tempDir);

      expect(slugs).toContain("sample-project");
      expect(slugs).not.toContain("invalid-project");
      expect(slugs).toHaveLength(1);
    });

    it("returns empty array when .planning/graph/ does not exist", async () => {
      const tempDir = join(tmpdir(), `forge-test-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true });
      dirs.push(tempDir);

      const slugs = await discoverGraphs(tempDir);

      expect(slugs).toEqual([]);
    });
  });

  describe("frontmatter parsing", () => {
    it("handles multiline acceptance arrays correctly", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const req = await loadRequirement(tempDir, SLUG, "req-001");

      expect(req).not.toBeNull();
      expect(req!.acceptance).toHaveLength(3);
      expect(req!.acceptance[0]).toBe(
        "Project scaffold is created with TypeScript configuration",
      );
      expect(req!.acceptance[1]).toBe(
        "Entry point src/index.ts exists and compiles",
      );
      expect(req!.acceptance[2]).toBe(
        "Configuration file src/config.ts exports default settings",
      );
    });

    it("handles nested files object with creates and modifies", async () => {
      const tempDir = await createTempGraph();
      dirs.push(tempDir);

      const req = await loadRequirement(tempDir, SLUG, "req-001");

      expect(req).not.toBeNull();
      expect(req!.files).toBeDefined();
      expect(req!.files.creates).toEqual([
        "src/index.ts",
        "src/config.ts",
        "package.json",
      ]);
      expect(req!.files.modifies).toEqual([]);
    });
  });
});
