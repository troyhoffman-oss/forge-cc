import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { forgeConfigSchema } from "./schema.js";
import type { ForgeConfig } from "../types.js";

export function loadConfig(projectDir: string): ForgeConfig {
  const configPath = join(projectDir, ".forge.json");

  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return forgeConfigSchema.parse(raw);
  }

  // Auto-detect from package.json
  return autoDetectConfig(projectDir);
}

function autoDetectConfig(projectDir: string): ForgeConfig {
  const gates: string[] = [];

  try {
    const pkgPath = join(projectDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (allDeps.typescript) gates.push("types");
    if (allDeps["@biomejs/biome"] || allDeps.biome) gates.push("lint");
    if (pkg.scripts?.test) gates.push("tests");
  } catch {
    // No package.json or invalid — use defaults
    gates.push("types", "lint", "tests");
  }

  if (gates.length === 0) {
    gates.push("types", "lint", "tests");
  }

  return forgeConfigSchema.parse({ gates });
}
