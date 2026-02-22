import { writeFile, rename, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { graphIndexSchema } from "./schemas.js";
import type {
  GraphIndex,
  Requirement,
  RequirementMeta,
  RequirementStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

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

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

async function atomicWrite(targetPath: string, content: string): Promise<void> {
  const temp = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temp, content, "utf-8");
  await rename(temp, targetPath);
}

// ---------------------------------------------------------------------------
// Read index helper (for read-modify-write operations)
// ---------------------------------------------------------------------------

async function readIndex(projectDir: string, slug: string): Promise<GraphIndex> {
  const raw = await readFile(indexPath(projectDir, slug), "utf-8");
  const parsed: unknown = yamlParse(raw);
  return graphIndexSchema.parse(parsed);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Serialize GraphIndex to YAML and write atomically to _index.yaml. */
export async function writeIndex(
  projectDir: string,
  slug: string,
  index: GraphIndex,
): Promise<void> {
  const dir = graphDir(projectDir, slug);
  await mkdir(dir, { recursive: true });
  const target = indexPath(projectDir, slug);
  await atomicWrite(target, yamlStringify(index));
}

/** Serialize Requirement to YAML frontmatter + markdown body and write atomically. */
export async function writeRequirement(
  projectDir: string,
  slug: string,
  req: Requirement,
): Promise<void> {
  const reqDir = requirementsDir(projectDir, slug);
  await mkdir(reqDir, { recursive: true });

  // Build frontmatter object (everything except body)
  const frontmatter: Record<string, unknown> = {
    id: req.id,
    title: req.title,
  };
  if (req.dependsOn) {
    frontmatter.dependsOn = req.dependsOn;
  }
  frontmatter.files = req.files;
  frontmatter.acceptance = req.acceptance;

  const content = `---\n${yamlStringify(frontmatter)}---\n\n${req.body}`;

  // Determine target filename
  const fileSlug = titleToSlug(req.title);
  const targetName = `${req.id}-${fileSlug}.md`;
  const targetPath = join(reqDir, targetName);

  // Check for existing file with the same ID (different slug)
  const entries = await readdir(reqDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry.startsWith(`${req.id}-`) && entry.endsWith(".md") && entry !== targetName) {
      // Remove old file by overwriting at the new path (old file gets orphaned — clean it)
      const { unlink } = await import("node:fs/promises");
      await unlink(join(reqDir, entry));
    }
  }

  await atomicWrite(targetPath, content);
}

/** Write overview.md content atomically. */
export async function writeOverview(
  projectDir: string,
  slug: string,
  content: string,
): Promise<void> {
  const dir = graphDir(projectDir, slug);
  await mkdir(dir, { recursive: true });
  const target = overviewPath(projectDir, slug);
  await atomicWrite(target, content);
}

/** Create full directory structure and initial files for a new graph. */
export async function initGraph(
  projectDir: string,
  slug: string,
  index: GraphIndex,
  overview: string,
): Promise<void> {
  const dir = graphDir(projectDir, slug);

  // Throw if graph directory already exists
  try {
    await stat(dir);
    throw new Error(`Graph directory already exists: ${dir}`);
  } catch (err: unknown) {
    // If the error is our own "already exists" throw, re-throw it
    if (err instanceof Error && err.message.startsWith("Graph directory already exists")) {
      throw err;
    }
    // Otherwise it's ENOENT (doesn't exist) — proceed
  }

  // Create directory structure
  await mkdir(requirementsDir(projectDir, slug), { recursive: true });

  // Write initial files
  await writeIndex(projectDir, slug, index);
  await writeOverview(projectDir, slug, overview);
}

/** Atomic read-modify-write: update a single requirement's status. */
export async function updateRequirementStatus(
  projectDir: string,
  slug: string,
  requirementId: string,
  status: RequirementStatus,
): Promise<GraphIndex> {
  const index = await readIndex(projectDir, slug);

  if (!index.requirements[requirementId]) {
    throw new Error(`Requirement not found in index: ${requirementId}`);
  }

  index.requirements[requirementId].status = status;
  if (status === "complete") {
    index.requirements[requirementId].completedAt = new Date().toISOString();
  }

  await writeIndex(projectDir, slug, index);
  return index;
}

/** Atomic read-modify-write: update multiple requirement statuses in one operation. */
export async function batchUpdateStatus(
  projectDir: string,
  slug: string,
  updates: Array<{ requirementId: string; status: RequirementStatus }>,
): Promise<GraphIndex> {
  const index = await readIndex(projectDir, slug);

  // Validate all IDs exist before making any changes
  for (const { requirementId } of updates) {
    if (!index.requirements[requirementId]) {
      throw new Error(`Requirement not found in index: ${requirementId}`);
    }
  }

  // Apply all updates
  for (const { requirementId, status } of updates) {
    index.requirements[requirementId].status = status;
    if (status === "complete") {
      index.requirements[requirementId].completedAt = new Date().toISOString();
    }
  }

  await writeIndex(projectDir, slug, index);
  return index;
}

/** Add a discovered requirement: write index first (crash-safe), then write the requirement file. */
export async function addDiscoveredRequirement(
  projectDir: string,
  slug: string,
  req: Requirement,
  meta: Omit<RequirementMeta, "status">,
): Promise<GraphIndex> {
  const index = await readIndex(projectDir, slug);

  if (index.requirements[req.id]) {
    throw new Error(`Requirement already exists in index: ${req.id}`);
  }

  // Index-first ordering for crash safety
  index.requirements[req.id] = {
    ...meta,
    status: "discovered",
  };
  await writeIndex(projectDir, slug, index);

  // Then write the requirement file
  await writeRequirement(projectDir, slug, req);

  return index;
}
