import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { graphIndexSchema, requirementFrontmatterSchema } from "./schemas.js";
import type { GraphIndex, ProjectGraph, Requirement } from "./types.js";

function graphDir(projectDir: string, slug: string): string {
  return join(projectDir, ".planning", "graph", slug);
}

function indexPath(projectDir: string, slug: string): string {
  return join(graphDir(projectDir, slug), "_index.yaml");
}

function overviewPath(projectDir: string, slug: string): string {
  return join(graphDir(projectDir, slug), "overview.md");
}

function requirementsDir(projectDir: string, slug: string): string {
  return join(graphDir(projectDir, slug), "requirements");
}

/** Parse YAML frontmatter from a markdown file. Returns frontmatter object and body string. */
function parseFrontmatter(content: string): { frontmatter: unknown; body: string } {
  if (!content.startsWith("---\n")) {
    throw new Error("Missing YAML frontmatter opening ---");
  }
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error("Missing YAML frontmatter closing ---");
  }
  const yamlStr = content.slice(4, end);
  const body = content.slice(end + 5).trim();
  return { frontmatter: yamlParse(yamlStr), body };
}

/** Parse a requirement .md file into a Requirement. */
function parseRequirementFile(content: string): Requirement {
  const { frontmatter, body } = parseFrontmatter(content);
  const parsed = requirementFrontmatterSchema.parse(frontmatter);
  return { ...parsed, body };
}

/** Load complete project graph: index, overview, and all requirements. */
export async function loadGraph(projectDir: string, slug: string): Promise<ProjectGraph> {
  const index = await loadIndex(projectDir, slug);
  const overview = await loadOverview(projectDir, slug);

  const requirements = new Map<string, Requirement>();
  let entries: string[];
  try {
    entries = await readdir(requirementsDir(projectDir, slug));
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const raw = await readFile(join(requirementsDir(projectDir, slug), entry), "utf-8");
    const req = parseRequirementFile(raw);
    requirements.set(req.id, req);
  }

  return { index, overview, requirements };
}

/** Fast path: load and validate _index.yaml only. */
export async function loadIndex(projectDir: string, slug: string): Promise<GraphIndex> {
  const raw = await readFile(indexPath(projectDir, slug), "utf-8");
  const data: unknown = yamlParse(raw);
  return graphIndexSchema.parse(data);
}

/** Load a single requirement by ID. Returns null if not found. */
export async function loadRequirement(
  projectDir: string,
  slug: string,
  id: string,
): Promise<Requirement | null> {
  let entries: string[];
  try {
    entries = await readdir(requirementsDir(projectDir, slug));
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const raw = await readFile(join(requirementsDir(projectDir, slug), entry), "utf-8");
    const req = parseRequirementFile(raw);
    if (req.id === id) return req;
  }

  return null;
}

/** Load multiple requirements by ID in a single directory scan. */
export async function loadRequirements(
  projectDir: string,
  slug: string,
  ids: string[],
): Promise<Map<string, Requirement>> {
  const wanted = new Set(ids);
  const result = new Map<string, Requirement>();

  let entries: string[];
  try {
    entries = await readdir(requirementsDir(projectDir, slug));
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const raw = await readFile(join(requirementsDir(projectDir, slug), entry), "utf-8");
    const req = parseRequirementFile(raw);
    if (wanted.has(req.id)) {
      result.set(req.id, req);
      if (result.size === wanted.size) break;
    }
  }

  return result;
}

/** Read overview.md as a string. Throws if missing. */
export async function loadOverview(projectDir: string, slug: string): Promise<string> {
  return readFile(overviewPath(projectDir, slug), "utf-8");
}

/** Discover all valid graph slugs in .planning/graph/. */
export async function discoverGraphs(projectDir: string): Promise<string[]> {
  const baseDir = join(projectDir, ".planning", "graph");
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return [];
  }

  const slugs: string[] = [];
  for (const entry of entries) {
    try {
      const idx = join(baseDir, entry, "_index.yaml");
      const raw = await readFile(idx, "utf-8");
      const data: unknown = yamlParse(raw);
      graphIndexSchema.parse(data);
      slugs.push(entry);
    } catch {
      // skip invalid entries
    }
  }

  return slugs;
}
