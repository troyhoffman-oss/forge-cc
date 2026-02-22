import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { detectFormat } from "../../src/runner/detect.js";

function tempDir() {
  return join(tmpdir(), `forge-test-${randomUUID()}`);
}

describe("detectFormat", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("returns 'graph' when _index.yaml exists", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const graphDir = join(dir, ".planning", "graph", "my-slug");
    await mkdir(graphDir, { recursive: true });
    await writeFile(
      join(graphDir, "_index.yaml"),
      "project: Test\nslug: my-slug\nbranch: feat/test\ncreatedAt: '2026-01-01'\ngroups: {}\nrequirements: {}\n",
    );

    const result = await detectFormat(dir, "my-slug");
    expect(result).toBe("graph");
  });

  it("returns 'prd' when graph directory does not exist", async () => {
    const dir = tempDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    const result = await detectFormat(dir, "my-slug");
    expect(result).toBe("prd");
  });

  it("returns 'prd' when slug directory exists but _index.yaml is missing", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const graphDir = join(dir, ".planning", "graph", "my-slug");
    await mkdir(graphDir, { recursive: true });

    const result = await detectFormat(dir, "my-slug");
    expect(result).toBe("prd");
  });

  it("returns 'prd' when .planning/graph/ directory does not exist at all", async () => {
    const dir = tempDir();
    dirs.push(dir);
    // Create just the base dir with no .planning at all
    await mkdir(dir, { recursive: true });

    const result = await detectFormat(dir, "any-slug");
    expect(result).toBe("prd");
  });
});
