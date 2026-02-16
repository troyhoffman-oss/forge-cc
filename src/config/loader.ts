import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { forgeConfigSchema } from "./schema.js";
import type { ForgeConfig, TestingConfig } from "../types.js";

export function loadConfig(projectDir: string): ForgeConfig {
  const configPath = join(projectDir, ".forge.json");

  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      return forgeConfigSchema.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Failed to parse .forge.json (${message}). Falling back to auto-detect.`);
    }
  }

  // Auto-detect from package.json
  return autoDetectConfig(projectDir);
}

function detectTestDir(projectDir: string): string {
  for (const dir of ["tests", "__tests__", "test"]) {
    if (existsSync(join(projectDir, dir))) {
      return dir;
    }
  }
  return "tests";
}

function detectTestingConfig(projectDir: string, allDeps: Record<string, string>): TestingConfig | undefined {
  const runner = allDeps.vitest ? "vitest" : allDeps.jest ? "jest" : null;
  if (!runner) return undefined;

  return {
    enforce: false,
    runner,
    testDir: detectTestDir(projectDir),
    sourceDir: "src",
    structural: true,
    categories: [],
  };
}

function autoDetectConfig(projectDir: string): ForgeConfig {
  const gates: string[] = [];
  let testing: TestingConfig | undefined;

  try {
    const pkgPath = join(projectDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (allDeps.typescript) gates.push("types");
    if (allDeps["@biomejs/biome"] || allDeps.biome) gates.push("lint");
    if (pkg.scripts?.test) gates.push("tests");

    testing = detectTestingConfig(projectDir, allDeps);
  } catch {
    // No package.json or invalid — use defaults
    gates.push("types", "lint", "tests");
  }

  if (gates.length === 0) {
    gates.push("types", "lint", "tests");
  }

  return forgeConfigSchema.parse({ gates, testing });
}
