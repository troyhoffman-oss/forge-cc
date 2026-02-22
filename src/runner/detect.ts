import { access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Detect whether a slug uses the graph format or the legacy PRD format.
 *
 * Checks if .planning/graph/{slug}/_index.yaml exists.
 * If it does → "graph". Otherwise → "prd".
 */
export async function detectFormat(
  projectDir: string,
  slug: string,
): Promise<"graph" | "prd"> {
  const indexPath = join(projectDir, ".planning", "graph", slug, "_index.yaml");
  try {
    await access(indexPath);
    return "graph";
  } catch {
    return "prd";
  }
}
