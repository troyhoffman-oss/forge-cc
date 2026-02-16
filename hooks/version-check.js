#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Read hook input from stdin
let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    checkForUpdate();
  } catch {
    // Silent failure — never crash, never block
  }
  // Always exit cleanly with no output (allow session to proceed)
  process.exit(0);
});

function checkForUpdate() {
  // Get installed version from forge-cc's own package.json
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const currentVersion = pkg.version;

  if (!currentVersion) return;

  // Query npm registry for latest version (5 second timeout)
  let latestVersion;
  try {
    const result = execSync("npm view forge-cc version --json", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    latestVersion = JSON.parse(result);
  } catch {
    // Offline, npm slow, or package not published yet — skip silently
    return;
  }

  if (typeof latestVersion !== "string" || !latestVersion) return;

  // Compare versions using semver-compatible numeric comparison
  if (isOutdated(currentVersion, latestVersion)) {
    process.stderr.write(
      `[forge] Update available: v${currentVersion} → v${latestVersion}. Run /forge:update to upgrade.\n`
    );
  }
}

/**
 * Returns true if `current` is older than `latest`.
 * Splits on ".", compares major/minor/patch numerically.
 */
function isOutdated(current, latest) {
  const parseParts = (v) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10));

  const cur = parseParts(current);
  const lat = parseParts(latest);

  for (let i = 0; i < 3; i++) {
    const c = cur[i] || 0;
    const l = lat[i] || 0;
    if (l > c) return true;
    if (c > l) return false;
  }
  return false;
}
