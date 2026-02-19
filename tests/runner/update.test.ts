import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tempDir() {
  return join(tmpdir(), `forge-update-test-${randomUUID()}`);
}

describe("version update check", () => {
  const dirs: string[] = [];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function setupProjectDir() {
    const dir = tempDir();
    dirs.push(dir);
    return dir;
  }

  it("respects once-per-day cache and skips network call", async () => {
    const projectDir = setupProjectDir();

    // Write a fresh cache (timestamp = now)
    const cacheDir = join(projectDir, ".forge");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(cacheDir, "version-check.json"),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        latestVersion: "1.0.0",
      }),
      "utf-8",
    );

    // Mock global fetch to track if it's called
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "2.0.0" }), { status: 200 }),
    );

    const { checkForUpdate } = await import("../../src/runner/update.js");
    await checkForUpdate(projectDir);

    // fetch should NOT have been called because cache is fresh
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches from registry when cache is stale", async () => {
    const projectDir = setupProjectDir();

    // Write a stale cache (timestamp = 2 days ago)
    const cacheDir = join(projectDir, ".forge");
    await mkdir(cacheDir, { recursive: true });
    const staleDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await writeFile(
      join(cacheDir, "version-check.json"),
      JSON.stringify({
        timestamp: staleDate.toISOString(),
        latestVersion: "0.9.0",
      }),
      "utf-8",
    );

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "2.0.0" }), { status: 200 }),
    );

    const { checkForUpdate } = await import("../../src/runner/update.js");
    await checkForUpdate(projectDir);

    // fetch SHOULD have been called because cache is stale
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Cache should be updated
    const cacheRaw = await readFile(join(cacheDir, "version-check.json"), "utf-8");
    const cache = JSON.parse(cacheRaw);
    expect(cache.latestVersion).toBe("2.0.0");
  });

  it("fetches from registry when no cache exists", async () => {
    const projectDir = setupProjectDir();

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 }),
    );

    const { checkForUpdate } = await import("../../src/runner/update.js");
    await checkForUpdate(projectDir);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
