import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeConfigSchema } from "./schema.js";
import type { ForgeConfig } from "../types.js";

const TOOL_GATE_MAP: Record<string, string> = {
  typescript: "types",
  biome: "lint",
  vitest: "tests",
  jest: "tests",
};

function detectGates(packageJson: Record<string, unknown>): string[] {
  const deps = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };
  const gates = new Set<string>();
  for (const [pkg, gate] of Object.entries(TOOL_GATE_MAP)) {
    if (pkg in deps) {
      gates.add(gate);
    }
  }
  return [...gates];
}

export async function loadConfig(
  projectDir: string = process.cwd(),
): Promise<ForgeConfig> {
  let raw: Record<string, unknown> | undefined;
  let hasExplicitGates = false;

  try {
    const content = await readFile(join(projectDir, ".forge.json"), "utf-8");
    raw = JSON.parse(content) as Record<string, unknown>;
    hasExplicitGates = "gates" in raw;
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      // No config file — use defaults
    } else {
      throw err;
    }
  }

  const config = forgeConfigSchema.parse(raw ?? {});

  // Auto-detect gates from package.json when no explicit gates set
  if (!hasExplicitGates) {
    try {
      const pkgContent = await readFile(
        join(projectDir, "package.json"),
        "utf-8",
      );
      const packageJson = JSON.parse(pkgContent) as Record<string, unknown>;
      const detected = detectGates(packageJson);
      if (detected.length > 0) {
        const merged = new Set([...config.gates, ...detected]);
        config.gates = [...merged];
      }
    } catch {
      // No package.json or unreadable — skip auto-detect
    }
  }

  return config;
}
