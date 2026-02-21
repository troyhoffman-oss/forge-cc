import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../src/config/loader.js";
import { forgeConfigSchema } from "../../src/config/schema.js";

function tempDir() {
  return join(tmpdir(), `forge-test-${randomUUID()}`);
}

describe("config", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("returns defaults when .forge.json is missing", async () => {
    const dir = tempDir();
    await mkdir(dir, { recursive: true });
    dirs.push(dir);

    const config = await loadConfig(dir);

    expect(config.gates).toEqual(["types", "lint", "tests"]);
    expect(config.maxIterations).toBe(5);
    expect(config.linearTeam).toBe("");
    expect(config.verifyFreshness).toBe(600000);
    expect(config.forgeVersion).toBe("1.0.0");
    expect(config.gateTimeouts).toEqual({});
  });

  it("throws on invalid JSON", async () => {
    const dir = tempDir();
    await mkdir(dir, { recursive: true });
    dirs.push(dir);

    await writeFile(join(dir, ".forge.json"), "{invalid", "utf-8");

    await expect(loadConfig(dir)).rejects.toThrow();
  });

  it("merges auto-detected values with explicit config", async () => {
    const dir = tempDir();
    await mkdir(dir, { recursive: true });
    dirs.push(dir);

    await writeFile(
      join(dir, ".forge.json"),
      JSON.stringify({ maxIterations: 3 }),
      "utf-8",
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );

    const config = await loadConfig(dir);

    expect(config.maxIterations).toBe(3);
    // Auto-detected "types" gate should be present since gates weren't explicit
    expect(config.gates).toContain("types");
  });

  it("Zod schema rejects unknown fields", () => {
    expect(() =>
      forgeConfigSchema.parse({ unknownField: "value" }),
    ).toThrow();
  });
});
