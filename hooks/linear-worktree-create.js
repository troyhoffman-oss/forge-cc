#!/usr/bin/env node

/**
 * Claude Code WorktreeCreate hook — branch naming + Linear issue sync.
 *
 * Contract:
 *   stdin:  JSON  { name: string, cwd: string }
 *   stdout: absolute worktree path (printed to stdout)
 *   exit:   always 0 (graceful degradation on any failure)
 *
 * Behaviour:
 *   1. Parse stdin to extract worktree name and cwd.
 *   2. Extract reqId from the name (e.g. "req-001" in "agent-req-001-abc").
 *   3. Discover _index.yaml graphs, find the requirement's linearIssueId.
 *   4. Resolve the issue identifier (e.g. "FRG-132") via Linear API.
 *   5. Create git worktree with branch: feat/<slug>/<identifier>-<reqId>
 *   6. Call syncRequirementStart() to transition issue + project to In Progress.
 *   7. Print absolute worktree path to stdout.
 *   Falls back to a generic worktree if any step fails.
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  try {
    await handleWorktreeCreate();
  } catch (err) {
    // Last-resort fallback: create a plain worktree
    try {
      fallbackWorktree();
    } catch {
      // Absolute last resort — print nothing, exit 0
      process.stderr.write(`[forge] WorktreeCreate hook failed entirely: ${err}\n`);
    }
  }
  process.exit(0);
});

/** Extract reqId from a name string. Matches "req-NNN" patterns. */
function extractReqId(name) {
  const match = name.match(/\b(req-\d{3})\b/i);
  return match ? match[1].toLowerCase() : null;
}

/** Read and parse a YAML file using minimal parsing (no dependency needed for simple _index.yaml). */
function parseSimpleYaml(content) {
  // Use the yaml package from forge-cc's dependencies if available, else try inline
  try {
    const forgePkgDir = resolveForgePackageDir();
    if (forgePkgDir) {
      const yamlMod = join(forgePkgDir, "node_modules", "yaml", "dist", "index.js");
      // Dynamic import won't work synchronously, use the built-in approach
    }
  } catch { /* fall through */ }
  // Inline minimal YAML parse for _index.yaml — handles the fields we need
  return null;
}

/** Locate the forge-cc package directory (global install or local). */
function resolveForgePackageDir() {
  // 1. Relative to this hook file (when running from the package)
  const localPkg = join(__dirname, "..", "package.json");
  if (existsSync(localPkg)) {
    try {
      const pkg = JSON.parse(readFileSync(localPkg, "utf-8"));
      if (pkg.name === "forge-cc") return dirname(localPkg);
    } catch { /* continue */ }
  }

  // 2. Global install via APPDATA (Windows) or npm root -g
  if (process.env.APPDATA) {
    const winPath = join(process.env.APPDATA, "npm", "node_modules", "forge-cc");
    if (existsSync(join(winPath, "package.json"))) return winPath;
  }

  // 3. npm root -g fallback
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim();
    const globalPath = join(globalRoot, "forge-cc");
    if (existsSync(join(globalPath, "package.json"))) return globalPath;
  } catch { /* continue */ }

  return null;
}

/** Discover graph slugs and load their _index.yaml files. */
function discoverGraphsSync(projectDir) {
  const baseDir = join(projectDir, ".planning", "graph");
  if (!existsSync(baseDir)) return [];

  const entries = readdirSync(baseDir);
  const graphs = [];

  for (const entry of entries) {
    const indexFile = join(baseDir, entry, "_index.yaml");
    if (!existsSync(indexFile)) continue;
    try {
      const raw = readFileSync(indexFile, "utf-8");
      graphs.push({ slug: entry, raw, path: indexFile });
    } catch { /* skip invalid */ }
  }

  return graphs;
}

/** Extract a field value from raw YAML content (simple key: value parsing). */
function yamlField(raw, key) {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = raw.match(regex);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Extract a nested requirement's linearIssueId from raw _index.yaml. */
function extractLinearIssueId(raw, reqId) {
  // Look for the requirement block and its linearIssueId
  // YAML structure: requirements:\n  req-001:\n    ...\n    linearIssueId: <uuid>
  const reqPattern = new RegExp(
    `^\\s{2}${reqId}:\\s*\\n((?:\\s{4}.+\\n)*)`,
    "m"
  );
  const reqMatch = raw.match(reqPattern);
  if (!reqMatch) return null;

  const block = reqMatch[1];
  const idMatch = block.match(/^\s{4}linearIssueId:\s*(.+)$/m);
  return idMatch ? idMatch[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Extract linear.teamId from raw _index.yaml. */
function extractLinearTeamId(raw) {
  const match = raw.match(/^\s{2}teamId:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Extract linear.projectId from raw _index.yaml. */
function extractLinearProjectId(raw) {
  const match = raw.match(/^\s{2}projectId:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Get the current branch name. */
function getCurrentBranch(cwd) {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd,
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
}

/** Create a git worktree and return the absolute path. */
function createGitWorktree(cwd, worktreePath, branchName) {
  const absPath = resolve(cwd, worktreePath);
  const parentDir = dirname(absPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  execSync(
    `git worktree add "${absPath}" -b "${branchName}"`,
    { cwd, encoding: "utf-8", timeout: 30000 }
  );

  return absPath;
}

/** Resolve issue identifier via the Linear API (using @linear/sdk from forge-cc). */
async function resolveIssueIdentifier(linearIssueId) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey || !linearIssueId) return null;

  try {
    const forgePkgDir = resolveForgePackageDir();
    if (!forgePkgDir) return null;

    const distSync = join(forgePkgDir, "dist", "linear", "client.js");
    if (!existsSync(distSync)) return null;

    const clientMod = await import(`file://${distSync.replace(/\\/g, "/")}`);
    const client = new clientMod.ForgeLinearClient({ apiKey });
    const result = await client.getIssueIdentifier(linearIssueId);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Call syncRequirementStart via the compiled dist. */
async function callSyncRequirementStart(index, reqId) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return;

  try {
    const forgePkgDir = resolveForgePackageDir();
    if (!forgePkgDir) return;

    const clientPath = join(forgePkgDir, "dist", "linear", "client.js");
    const syncPath = join(forgePkgDir, "dist", "linear", "sync.js");
    if (!existsSync(clientPath) || !existsSync(syncPath)) return;

    const clientMod = await import(`file://${clientPath.replace(/\\/g, "/")}`);
    const syncMod = await import(`file://${syncPath.replace(/\\/g, "/")}`);

    const client = new clientMod.ForgeLinearClient({ apiKey });
    await syncMod.syncRequirementStart(client, index, reqId);
  } catch (err) {
    process.stderr.write(`[forge] syncRequirementStart failed (non-blocking): ${err}\n`);
  }
}

/** Build a minimal GraphIndex object from raw YAML for syncRequirementStart. */
function buildMinimalIndex(raw, slug, reqId, linearIssueId) {
  return {
    project: yamlField(raw, "project") || "unknown",
    slug,
    branch: yamlField(raw, "branch") || "main",
    createdAt: yamlField(raw, "createdAt") || new Date().toISOString(),
    linear: {
      projectId: extractLinearProjectId(raw) || "",
      teamId: extractLinearTeamId(raw) || "",
    },
    groups: {},
    requirements: {
      [reqId]: {
        group: "",
        status: "in_progress",
        dependsOn: [],
        linearIssueId: linearIssueId || undefined,
      },
    },
  };
}

/** Create a fallback worktree with a generic branch name. */
function fallbackWorktree() {
  let parsed = {};
  try { parsed = JSON.parse(input); } catch { /* empty */ }
  const name = parsed.name || `worktree-${Date.now()}`;
  const cwd = parsed.cwd || process.cwd();

  const worktreePath = join(".claude", "worktrees", name);
  const branchName = `worktree/${name}`;
  const absPath = createGitWorktree(cwd, worktreePath, branchName);
  process.stdout.write(absPath);
}

/** Main hook handler. */
async function handleWorktreeCreate() {
  const parsed = JSON.parse(input);
  const name = parsed.name || "";
  const cwd = parsed.cwd || process.cwd();

  // 1. Extract reqId from the worktree name
  let reqId = extractReqId(name);

  // 2. If no reqId in name, try .forge/build-context.json
  if (!reqId) {
    try {
      const ctxPath = join(cwd, ".forge", "build-context.json");
      if (existsSync(ctxPath)) {
        const ctx = JSON.parse(readFileSync(ctxPath, "utf-8"));
        if (ctx.requirementId) {
          reqId = ctx.requirementId;
        }
      }
    } catch { /* continue without reqId */ }
  }

  // 3. If still no reqId, fall back to generic worktree
  if (!reqId) {
    fallbackWorktree();
    return;
  }

  // 4. Discover graphs and find the requirement
  const graphs = discoverGraphsSync(cwd);
  let matchedSlug = null;
  let matchedRaw = null;
  let linearIssueId = null;

  for (const g of graphs) {
    const issueId = extractLinearIssueId(g.raw, reqId);
    if (issueId || g.raw.includes(`  ${reqId}:`)) {
      matchedSlug = g.slug;
      matchedRaw = g.raw;
      linearIssueId = issueId;
      break;
    }
  }

  if (!matchedSlug || !matchedRaw) {
    // reqId found but no matching graph — create worktree with reqId but no Linear identifier
    const worktreePath = join(".claude", "worktrees", name);
    const branchName = `feat/${name}`;
    const absPath = createGitWorktree(cwd, worktreePath, branchName);
    process.stdout.write(absPath);
    return;
  }

  // 5. Resolve the Linear issue identifier (e.g. "FRG-132")
  const issueIdentifier = await resolveIssueIdentifier(linearIssueId);

  // 6. Build the branch name
  let branchName;
  if (issueIdentifier) {
    // feat/<slug>/<FRG-132>-<req-001>
    branchName = `feat/${matchedSlug}/${issueIdentifier}-${reqId}`;
  } else {
    // No Linear identifier — use slug/reqId only
    branchName = `feat/${matchedSlug}/${reqId}`;
  }

  // Sanitize branch name (lowercase, no special chars except - and /)
  branchName = branchName.toLowerCase().replace(/[^a-z0-9/\-]/g, "-");

  // 7. Create the worktree
  const worktreePath = join(".claude", "worktrees", name);
  const absPath = createGitWorktree(cwd, worktreePath, branchName);

  // 8. Sync Linear status (non-blocking — don't fail if this errors)
  try {
    const minimalIndex = buildMinimalIndex(matchedRaw, matchedSlug, reqId, linearIssueId);
    await callSyncRequirementStart(minimalIndex, reqId);
  } catch (err) {
    process.stderr.write(`[forge] Linear sync failed (non-blocking): ${err}\n`);
  }

  // 9. Print absolute worktree path to stdout (WorktreeCreate contract)
  process.stdout.write(absPath);
}
