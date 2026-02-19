import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineResult, VerifyCache } from "../types.js";

/** Write verification results to .forge/last-verify.json. */
export async function writeVerifyCache(
  projectDir: string,
  pipeline: PipelineResult,
): Promise<void> {
  const forgeDir = join(projectDir, ".forge");
  await mkdir(forgeDir, { recursive: true });

  const cache: VerifyCache = {
    timestamp: new Date().toISOString(),
    result: pipeline.result,
    gates: {},
  };

  for (const gate of pipeline.gates) {
    cache.gates[gate.gate] = {
      passed: gate.passed,
      errors: gate.errors.length > 0 ? gate.errors : undefined,
      summary: gate.passed
        ? "passed"
        : `${gate.errors.length} error(s)`,
    };
  }

  await writeFile(
    join(forgeDir, "last-verify.json"),
    JSON.stringify(cache, null, 2),
    "utf-8",
  );
}
