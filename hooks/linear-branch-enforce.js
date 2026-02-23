#!/usr/bin/env node

/**
 * PreToolUse hook — Bash command interceptor for branch name rewriting.
 *
 * When an agent creates a branch via `git checkout -b`, `git switch -c`,
 * or `git branch <name>`, this hook rewrites the branch name to include
 * the Linear issue identifier (e.g. FRG-132) if one can be resolved.
 *
 * Hook type: PreToolUse (matcher: Bash)
 * Always exits 0 — never blocks the agent's command.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ── stdin reading ──────────────────────────────────────────────────────
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const hookData = JSON.parse(input);
    handleHook(hookData);
  } catch {
    // Never block — exit silently on any error
    process.exit(0);
  }
});

// ── main handler ───────────────────────────────────────────────────────
function handleHook(hookData) {
  // Only intercept Bash tool calls
  if (hookData.tool_name !== "Bash") {
    process.exit(0);
  }

  const command = hookData.tool_input?.command ?? "";

  // Fast bail-out: only match branch creation commands
  const branchInfo = parseBranchCreation(command);
  if (!branchInfo) {
    process.exit(0);
  }

  const { branchName, prefix, suffix } = branchInfo;

  // Already contains a Linear identifier (e.g. FRG-123) — no rewriting needed
  if (/[A-Z]+-\d+/.test(branchName)) {
    process.exit(0);
  }

  // Resolve the Linear issue identifier from project context
  const identifier = resolveIdentifier();
  if (!identifier) {
    // Can't resolve context — allow original command through
    process.exit(0);
  }

  // Rewrite the branch name to include the identifier
  const rewrittenBranch = injectIdentifier(branchName, identifier);
  const rewrittenCommand = prefix + rewrittenBranch + suffix;

  // Output the rewritten command via updatedInput
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        command: rewrittenCommand,
      },
    },
  };

  console.log(JSON.stringify(output));
  process.exit(0);
}

// ── branch parsing ─────────────────────────────────────────────────────

/**
 * Parse a git branch creation command. Returns null for non-matching commands.
 *
 * Matches:
 *   git checkout -b <branch> [start-point] [-- ...]
 *   git switch -c <branch> [start-point]
 *   git branch <name> (but NOT git branch -d/-D/-m/-M/--list etc.)
 *
 * Returns { branchName, prefix, suffix } where:
 *   prefix = everything before the branch name
 *   suffix = everything after the branch name
 */
function parseBranchCreation(command) {
  // git checkout -b <branch>
  const checkoutMatch = command.match(
    /^(.*git\s+checkout\s+(?:-[a-zA-Z]*b[a-zA-Z]*\s+|-b\s+))(\S+)(.*)/,
  );
  if (checkoutMatch) {
    // Normalize: handle flags like -Bb or -b
    return {
      prefix: checkoutMatch[1],
      branchName: checkoutMatch[2],
      suffix: checkoutMatch[3],
    };
  }

  // git switch -c <branch>
  const switchMatch = command.match(
    /^(.*git\s+switch\s+(?:-[a-zA-Z]*c[a-zA-Z]*\s+|-c\s+))(\S+)(.*)/,
  );
  if (switchMatch) {
    return {
      prefix: switchMatch[1],
      branchName: switchMatch[2],
      suffix: switchMatch[3],
    };
  }

  // git branch <name> — but not git branch -d/-D/-m/-M/--list/--delete etc.
  const branchMatch = command.match(
    /^(.*git\s+branch\s+)(\S+)(.*)/,
  );
  if (branchMatch) {
    const name = branchMatch[2];
    // Skip if the "name" is actually a flag
    if (name.startsWith("-")) {
      return null;
    }
    return {
      prefix: branchMatch[1],
      branchName: name,
      suffix: branchMatch[3],
    };
  }

  return null;
}

// ── identifier resolution ──────────────────────────────────────────────

/**
 * Try to resolve the Linear issue identifier for the current build context.
 *
 * Strategy:
 *   1. Read .forge/build-context.json for slug + reqId
 *   2. If no build context, try extracting reqId from current branch name
 *   3. Look up _index.yaml → find linearIssueId for the requirement
 *   4. Resolve identifier via Linear API (getIssueIdentifier)
 *
 * Returns identifier string (e.g. "FRG-132") or null.
 */
function resolveIdentifier() {
  const cwd = process.cwd();

  // Step 1: Try build context
  let slug = null;
  let reqId = null;
  const buildCtxPath = join(cwd, ".forge", "build-context.json");
  if (existsSync(buildCtxPath)) {
    try {
      const ctx = JSON.parse(readFileSync(buildCtxPath, "utf-8"));
      slug = ctx.slug || null;
      reqId = ctx.reqId || null;
    } catch {
      // ignore
    }
  }

  // Step 2: If no reqId from build context, try extracting from branch name
  if (!reqId) {
    try {
      const branch = execSync("git branch --show-current", {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      reqId = extractReqId(branch);
    } catch {
      // ignore
    }
  }

  if (!reqId) return null;

  // Step 3: Find linearIssueId from _index.yaml
  const linearIssueId = findLinearIssueId(cwd, reqId, slug);
  if (!linearIssueId) return null;

  // Step 4: Resolve identifier via Linear API
  return resolveIdentifierFromApi(linearIssueId);
}

/**
 * Extract a requirement ID (e.g. "req-002") from a string.
 */
function extractReqId(name) {
  const match = name.match(/\b(req-\d{3})\b/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Find the linearIssueId for a requirement by scanning _index.yaml files.
 * If slug is provided, look there first; otherwise scan all graphs.
 */
function findLinearIssueId(cwd, reqId, slug) {
  const graphDir = join(cwd, ".planning", "graph");

  if (slug) {
    const indexPath = join(graphDir, slug, "_index.yaml");
    const issueId = extractLinearIssueId(indexPath, reqId);
    if (issueId) return issueId;
  }

  // Scan all graph directories
  const graphs = discoverGraphsSync(cwd);
  for (const graphPath of graphs) {
    const issueId = extractLinearIssueId(graphPath, reqId);
    if (issueId) return issueId;
  }

  return null;
}

/**
 * Discover all _index.yaml paths under .planning/graph/
 */
function discoverGraphsSync(cwd) {
  const graphDir = join(cwd, ".planning", "graph");
  if (!existsSync(graphDir)) return [];

  const paths = [];
  try {
    const entries = readdirSync(graphDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const indexPath = join(graphDir, entry.name, "_index.yaml");
        if (existsSync(indexPath)) {
          paths.push(indexPath);
        }
      }
    }
  } catch {
    // ignore
  }
  return paths;
}

/**
 * Extract the linearIssueId for a specific requirement from a _index.yaml file.
 * Uses line-by-line YAML parsing (inline, no dependencies).
 */
function extractLinearIssueId(indexPath, reqId) {
  if (!existsSync(indexPath)) return null;

  try {
    const content = readFileSync(indexPath, "utf-8");
    const lines = content.split("\n");

    // Find the line "  <reqId>:" then scan indented lines for linearIssueId
    let inReqBlock = false;
    let reqIndent = -1;

    for (const line of lines) {
      // Match the requirement key line (e.g. "  req-002:")
      const keyMatch = line.match(/^(\s*)(\S+):\s*$/);
      if (keyMatch) {
        const indent = keyMatch[1].length;
        const key = keyMatch[2];
        if (key === reqId) {
          inReqBlock = true;
          reqIndent = indent;
          continue;
        } else if (inReqBlock && indent <= reqIndent) {
          // Left the requirement block — not found
          return null;
        }
      }

      if (inReqBlock) {
        // Check if this is a field at deeper indent
        const fieldMatch = line.match(/^\s+linearIssueId:\s*"?([^"\n]+)"?/);
        if (fieldMatch) {
          return fieldMatch[1].trim();
        }

        // If we encounter a line at same or lesser indent that's not empty, we left the block
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("-")) {
          const currentIndent = line.length - line.trimStart().length;
          if (currentIndent <= reqIndent) {
            return null;
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a Linear issue UUID to its human-readable identifier (e.g. "FRG-42")
 * via the compiled forge-cc dist/ Linear client.
 */
function resolveIdentifierFromApi(linearIssueId) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return null;

  try {
    const forgeDir = resolveForgePackageDir();
    if (!forgeDir) return null;

    // Synchronous workaround: spawn a child process with ESM-compatible import()
    const clientPath = join(forgeDir, "dist", "linear", "client.js").replace(/\\/g, "/");
    const script = `
      import(${JSON.stringify("file:///" + clientPath)}).then(mod => {
        const client = new mod.ForgeLinearClient({ apiKey: ${JSON.stringify(apiKey)} });
        return client.getIssueIdentifier(${JSON.stringify(linearIssueId)});
      }).then(r => {
        if (r.success) process.stdout.write(r.data);
      }).catch(() => {});
    `;

    const result = execSync(`node --input-type=module -e ${JSON.stringify(script)}`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    }).trim();

    return result || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the forge-cc package directory from the global npm install.
 * On Windows: APPDATA/npm/node_modules/forge-cc
 * On Unix: use npm root -g
 */
function resolveForgePackageDir() {
  // Try APPDATA first (Windows)
  if (process.env.APPDATA) {
    const winPath = join(process.env.APPDATA, "npm", "node_modules", "forge-cc");
    if (existsSync(winPath)) return winPath;
  }

  // Try npm root -g (Unix / fallback)
  try {
    const globalRoot = execSync("npm root -g", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const globalPath = join(globalRoot, "forge-cc");
    if (existsSync(globalPath)) return globalPath;
  } catch {
    // ignore
  }

  // Try local node_modules (dev scenario)
  const localPath = join(process.cwd(), "node_modules", "forge-cc");
  if (existsSync(localPath)) return localPath;

  return null;
}

// ── branch name rewriting ──────────────────────────────────────────────

/**
 * Inject the Linear identifier into a branch name.
 *
 * Examples:
 *   "feat/my-feature" + "FRG-132" → "feat/FRG-132-my-feature"
 *   "my-feature" + "FRG-132" → "FRG-132-my-feature"
 *   "feat/slug/req-001" + "FRG-132" → "feat/slug/FRG-132-req-001"
 */
function injectIdentifier(branchName, identifier) {
  // Split on last slash to find the leaf segment
  const lastSlashIdx = branchName.lastIndexOf("/");
  if (lastSlashIdx === -1) {
    // No prefix path — prepend identifier
    return `${identifier}-${branchName}`;
  }

  const pathPrefix = branchName.slice(0, lastSlashIdx + 1);
  const leaf = branchName.slice(lastSlashIdx + 1);
  return `${pathPrefix}${identifier}-${leaf}`;
}
