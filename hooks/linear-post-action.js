#!/usr/bin/env node

/**
 * PostToolUse hook — reacts to `gh pr create` and `gh pr merge` Bash commands.
 *
 * - On PR creation: links the PR to all complete requirement issues via
 *   attachIssuePullRequest(), then transitions the project to "In Review".
 * - On PR merge: transitions the project to "Completed".
 *
 * All Linear API calls are best-effort — errors are logged to stderr, never crash.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ── Stdin reading ──────────────────────────────────────────────────────────────

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  main().catch(() => {});
});

async function main() {
  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Only handle Bash tool calls
  if (hookData.tool_name !== "Bash") {
    process.exit(0);
  }

  const command = hookData.tool_input?.command ?? "";

  // Fast bail-out: if command doesn't match gh pr create or gh pr merge, exit immediately
  const isPrCreate = command.includes("gh pr create");
  const isPrMerge = command.includes("gh pr merge");
  if (!isPrCreate && !isPrMerge) {
    process.exit(0);
  }

  const toolResponse = hookData.tool_response ?? "";

  // Require LINEAR_API_KEY
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    process.exit(0);
  }

  // Discover the active graph for the current branch
  const cwd = process.cwd();
  let currentBranch;
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    process.stderr.write("[forge] Could not determine current branch, skipping Linear sync\n");
    process.exit(0);
  }

  const graphs = discoverGraphsSync(cwd);
  const activeGraph = findActiveGraph(graphs, currentBranch);
  if (!activeGraph) {
    process.exit(0);
  }

  // Load the ForgeLinearClient from the compiled dist
  let ForgeLinearClient;
  let syncGraphProjectReview;
  let syncGraphProjectCompleted;
  try {
    const forgePkgDir = resolveForgePkgDir();
    const clientMod = await import(join(forgePkgDir, "dist", "linear", "client.js"));
    ForgeLinearClient = clientMod.ForgeLinearClient;
    const syncMod = await import(join(forgePkgDir, "dist", "linear", "sync.js"));
    syncGraphProjectReview = syncMod.syncGraphProjectReview;
    syncGraphProjectCompleted = syncMod.syncGraphProjectCompleted;
  } catch (err) {
    process.stderr.write(`[forge] Could not load Linear modules: ${err}\n`);
    process.exit(0);
  }

  let client;
  try {
    client = new ForgeLinearClient({ apiKey });
  } catch (err) {
    process.stderr.write(`[forge] Could not create Linear client: ${err}\n`);
    process.exit(0);
  }

  if (isPrCreate) {
    await handlePrCreate(client, activeGraph, toolResponse, syncGraphProjectReview);
  } else if (isPrMerge) {
    // Only transition to Completed if the merge actually succeeded —
    // failed merges (conflicts, failed checks) should not update Linear.
    // gh pr merge outputs "✓ Merged" or "Merged pull request" on success.
    const mergeSucceeded = toolResponse &&
      (/[Mm]erged pull request/.test(toolResponse) || toolResponse.includes("✓"));
    if (mergeSucceeded) {
      await handlePrMerge(client, activeGraph, syncGraphProjectCompleted);
    }
  }
}

// ── PR Create handler ──────────────────────────────────────────────────────────

async function handlePrCreate(client, graph, toolResponse, syncGraphProjectReview) {
  // Parse PR URL from tool response — gh pr create outputs the URL as the last line
  const prUrl = parsePrUrl(toolResponse);
  if (!prUrl) {
    process.stderr.write("[forge] Could not parse PR URL from gh pr create output\n");
    process.exit(0);
  }

  const indexContent = readFileSync(graph.indexPath, "utf-8");
  const index = parseIndexYaml(indexContent, graph.slug);
  if (!index) {
    process.exit(0);
  }

  // Find all complete requirements with a linearIssueId
  const completeReqs = findCompleteRequirementsWithIssues(indexContent);
  let linkedCount = 0;

  // Attach PR to each complete requirement's Linear issue
  for (const req of completeReqs) {
    try {
      const result = await client.attachIssuePullRequest(req.linearIssueId, prUrl);
      if (result.success) {
        linkedCount++;
      } else {
        process.stderr.write(`[forge] Warning: could not link PR to ${req.id}: ${result.error}\n`);
      }
    } catch (err) {
      process.stderr.write(`[forge] Warning: failed to link PR to ${req.id}: ${err}\n`);
    }
  }

  // Transition project to In Review
  let reviewTransitioned = false;
  try {
    const syncResult = await syncGraphProjectReview(client, index);
    reviewTransitioned = syncResult.projectUpdated;
  } catch (err) {
    process.stderr.write(`[forge] Warning: failed to transition project to In Review: ${err}\n`);
  }

  const statusMsg = reviewTransitioned ? "project → In Review" : "project transition skipped";
  const msg = `Linear: PR linked to ${linkedCount} issues, ${statusMsg}`;
  console.log(JSON.stringify({
    hookSpecificOutput: {
      additionalContext: msg,
    },
  }));
}

// ── PR Merge handler ───────────────────────────────────────────────────────────

async function handlePrMerge(client, graph, syncGraphProjectCompleted) {
  const indexContent = readFileSync(graph.indexPath, "utf-8");
  const index = parseIndexYaml(indexContent, graph.slug);
  if (!index) {
    process.exit(0);
  }

  let completedTransitioned = false;
  try {
    const syncResult = await syncGraphProjectCompleted(client, index);
    completedTransitioned = syncResult.projectUpdated;
  } catch (err) {
    process.stderr.write(`[forge] Warning: failed to transition project to Completed: ${err}\n`);
  }

  const statusMsg = completedTransitioned ? "project → Completed" : "project transition skipped";
  console.log(JSON.stringify({
    hookSpecificOutput: {
      additionalContext: `Linear: ${statusMsg}`,
    },
  }));
}

// ── Graph discovery ────────────────────────────────────────────────────────────

function discoverGraphsSync(cwd) {
  const graphDir = join(cwd, ".planning", "graph");
  if (!existsSync(graphDir)) return [];
  return readdirSync(graphDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ slug: d.name, indexPath: join(graphDir, d.name, "_index.yaml") }))
    .filter((g) => existsSync(g.indexPath));
}

function findActiveGraph(graphs, currentBranch) {
  for (const g of graphs) {
    try {
      const content = readFileSync(g.indexPath, "utf-8");
      const branch = yamlField(content, "branch");
      if (branch === currentBranch) return g;
    } catch {
      // skip unreadable graphs
    }
  }
  return null;
}

// ── YAML parsing helpers ───────────────────────────────────────────────────────

function yamlField(content, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*["']?(.+?)["']?\\s*$`, "m");
  const match = content.match(regex);
  return match ? match[1] : null;
}

/**
 * Parse _index.yaml into a minimal GraphIndex-compatible object for sync functions.
 * Only extracts the fields needed by syncGraphProjectReview/syncGraphProjectCompleted.
 */
function parseIndexYaml(content, slug) {
  const project = yamlField(content, "project") || slug;
  const branch = yamlField(content, "branch") || "";

  // Extract linear config
  const projectIdMatch = content.match(/^  projectId:\s*["']?(.+?)["']?\s*$/m);
  const teamIdMatch = content.match(/^  teamId:\s*["']?(.+?)["']?\s*$/m);

  const linear =
    projectIdMatch && teamIdMatch
      ? { projectId: projectIdMatch[1], teamId: teamIdMatch[1] }
      : undefined;

  return {
    project,
    slug,
    branch,
    createdAt: yamlField(content, "createdAt") || "",
    linear,
    groups: {},
    requirements: {},
  };
}

/**
 * Find all requirements with `status: complete` and a `linearIssueId` from _index.yaml.
 * Uses regex-based extraction to avoid YAML parser dependency.
 */
function findCompleteRequirementsWithIssues(content) {
  const results = [];

  // Split the requirements section into individual requirement blocks
  const reqSectionMatch = content.match(/^requirements:\s*\n([\s\S]*)$/m);
  if (!reqSectionMatch) return results;

  const reqSection = reqSectionMatch[1];
  // Match each top-level requirement entry (e.g., "  REQ-001:")
  const reqBlockRegex = /^  ([\w-]+):\s*\n((?:    .+\n)*)/gm;
  let match;
  while ((match = reqBlockRegex.exec(reqSection)) !== null) {
    const reqId = match[1];
    const block = match[2];

    const statusMatch = block.match(/^\s+status:\s*(\S+)/m);
    const issueIdMatch = block.match(/^\s+linearIssueId:\s*["']?(.+?)["']?\s*$/m);

    if (statusMatch && statusMatch[1] === "complete" && issueIdMatch) {
      results.push({ id: reqId, linearIssueId: issueIdMatch[1] });
    }
  }

  return results;
}

// ── PR URL parsing ─────────────────────────────────────────────────────────────

function parsePrUrl(toolResponse) {
  // gh pr create outputs the PR URL — find a GitHub PR URL in the response
  const urlMatch = toolResponse.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/);
  return urlMatch ? urlMatch[1] : null;
}

// ── Forge package resolution ───────────────────────────────────────────────────

function resolveForgePkgDir() {
  // Try local node_modules first (dev/test scenarios)
  const localPath = join(process.cwd(), "node_modules", "forge-cc");
  if (existsSync(join(localPath, "dist", "linear", "client.js"))) {
    return localPath;
  }

  // Windows global install via APPDATA
  if (process.env.APPDATA) {
    const appDataPath = join(process.env.APPDATA, "npm", "node_modules", "forge-cc");
    if (existsSync(join(appDataPath, "dist", "linear", "client.js"))) {
      return appDataPath;
    }
  }

  // Unix global: try npm root -g
  try {
    const globalRoot = execSync("npm root -g", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const globalPath = join(globalRoot, "forge-cc");
    if (existsSync(join(globalPath, "dist", "linear", "client.js"))) {
      return globalPath;
    }
  } catch {
    // fallback below
  }

  // Fallback: resolve relative to this hook file's directory
  const hookDir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const pkgDir = join(hookDir, "..");
  if (existsSync(join(pkgDir, "dist", "linear", "client.js"))) {
    return pkgDir;
  }

  throw new Error("Could not locate forge-cc package with compiled dist/");
}
