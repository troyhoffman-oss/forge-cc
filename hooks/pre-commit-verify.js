#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Read hook input from stdin
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const hookData = JSON.parse(input);
    const result = checkPreCommit(hookData);
    console.log(JSON.stringify(result));
  } catch {
    // On any error, allow (don't block the user's work)
    console.log(JSON.stringify({ decision: "allow" }));
  }
});

function checkPreCommit(hookData) {
  // Only intercept Bash calls with "git commit" in the command
  if (hookData.tool_name !== "Bash") {
    return { decision: "allow" };
  }

  const command = hookData.tool_input?.command ?? "";
  if (!command.includes("git commit")) {
    return { decision: "allow" };
  }

  const projectDir = process.cwd();

  // Check 1: Wrong branch protection
  let branch = "unknown";
  try {
    branch = execSync("git branch --show-current", {
      encoding: "utf-8",
    }).trim();
    if (branch === "main" || branch === "master") {
      return {
        decision: "block",
        reason: `Forge: Cannot commit directly to ${branch}. Create a feature branch first.`,
      };
    }
  } catch {
    // Can't determine branch — allow
  }

  // Check 2: Verify cache exists — per-branch first, fall back to legacy path
  const slug = branch.replace(/\//g, "-").toLowerCase();
  const perBranchCachePath = join(projectDir, ".forge", "verify-cache", `${slug}.json`);
  const legacyCachePath = join(projectDir, ".forge", "last-verify.json");
  const cachePath = existsSync(perBranchCachePath)
    ? perBranchCachePath
    : legacyCachePath;
  if (!existsSync(cachePath)) {
    return {
      decision: "block",
      reason:
        "Forge: No verification found. Run `npx forge verify` before committing.",
    };
  }

  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));

    // Check 3: Did verification pass?
    if (!cache.passed) {
      return {
        decision: "block",
        reason:
          "Forge: Last verification FAILED. Fix errors and run `npx forge verify` again.",
      };
    }

    // Check 4: Is it fresh? (default 10 minutes = 600000ms)
    let freshness = 600_000;
    const configPath = join(projectDir, ".forge.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        if (config.verifyFreshness) freshness = config.verifyFreshness;
      } catch {
        /* use default */
      }
    }

    const age = Date.now() - new Date(cache.timestamp).getTime();
    if (age > freshness) {
      const ageMin = Math.round(age / 60_000);
      return {
        decision: "block",
        reason: `Forge: Verification is stale (${ageMin}min old). Run \`npx forge verify\` again.`,
      };
    }

    return { decision: "allow" };
  } catch {
    return {
      decision: "block",
      reason:
        "Forge: Could not read verification cache. Run `npx forge verify`.",
    };
  }
}
