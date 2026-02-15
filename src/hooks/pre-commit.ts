import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig } from "../config/loader.js";

export interface HookResult {
  allowed: boolean;
  reason?: string;
}

export function checkPreCommit(projectDir: string): HookResult {
  // Wrong branch protection
  try {
    const branch = execSync("git branch --show-current", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    if (branch === "main" || branch === "master") {
      return {
        allowed: false,
        reason: `Cannot commit directly to ${branch}. Create a feature branch first.`,
      };
    }
  } catch {
    // Can't determine branch — allow
  }

  // Check verify cache
  const cachePath = join(projectDir, ".forge", "last-verify.json");
  if (!existsSync(cachePath)) {
    return {
      allowed: false,
      reason:
        "No verification found. Run `npx forge verify` before committing.",
    };
  }

  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));

    if (!cache.passed) {
      return {
        allowed: false,
        reason:
          "Last verification FAILED. Fix errors and run `npx forge verify` again.",
      };
    }

    const config = loadConfig(projectDir);
    const age = Date.now() - new Date(cache.timestamp).getTime();
    if (age > config.verifyFreshness) {
      const ageMin = Math.round(age / 60_000);
      return {
        allowed: false,
        reason: `Verification is stale (${ageMin}min old). Run \`npx forge verify\` again.`,
      };
    }

    return { allowed: true };
  } catch {
    return {
      allowed: false,
      reason:
        "Could not read verification cache. Run `npx forge verify`.",
    };
  }
}
