import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config/loader.js";
import { gateRegistry, runPipeline } from "../src/gates/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures", "sample-project");

describe("Config Integration", () => {
  it("loads .forge.json from fixture project", () => {
    const config = loadConfig(fixtureDir);
    expect(config.gates).toEqual(["types", "tests"]);
    expect(config.maxIterations).toBe(3);
    expect(config.verifyFreshness).toBe(300_000);
  });

  it("auto-detects config when no .forge.json", () => {
    // Create a temp dir with only a package.json (no .forge.json) to test auto-detection
    const tempDir = mkdtempSync(join(tmpdir(), "forge-test-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({
          scripts: { test: "vitest run" },
          devDependencies: { typescript: "^5.7.0" },
        })
      );
      const config = loadConfig(tempDir);
      expect(config.gates).toContain("types");
      expect(config.gates).toContain("tests");
      expect(config.maxIterations).toBe(5); // default
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Gate Registry", () => {
  it("has all expected gates", () => {
    expect(Object.keys(gateRegistry)).toEqual(
      expect.arrayContaining(["types", "lint", "tests", "visual", "runtime", "prd"])
    );
  });

  it("skips unknown gates with warning in pipeline", async () => {
    const result = await runPipeline({
      projectDir: fixtureDir,
      gates: ["nonexistent"],
    });
    expect(result.passed).toBe(true); // unknown gates skip, not fail
    expect(result.gates[0].gate).toBe("nonexistent");
    expect(result.gates[0].passed).toBe(true);
    expect(result.gates[0].warnings[0]).toContain("not in the verify pipeline");
  });
});
