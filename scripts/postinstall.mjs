import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "..", "dist", "cli.js");
const pkgPath = resolve(__dirname, "..", "package.json");

let skillsSynced = false;
if (existsSync(cliPath)) {
  try {
    execFileSync(process.execPath, [cliPath, "setup", "--skills-only"], { stdio: "pipe" });
    skillsSynced = true;
  } catch {
    // Non-fatal: skill sync failure shouldn't block install
  }
}

// Print install summary (never block install)
try {
  const version = JSON.parse(readFileSync(pkgPath, "utf-8")).version;

  let playwrightInstalled = false;
  try {
    await import("playwright");
    playwrightInstalled = true;
  } catch {
    // not installed
  }

  console.log("");
  console.log(`  forge-cc v${version} installed`);

  if (skillsSynced) {
    console.log("    \u2713 Skills synced to ~/.claude/commands/forge/");
  } else {
    console.log("    \u2717 Skills not synced (run: forge setup)");
  }

  if (playwrightInstalled) {
    console.log("    \u2713 Playwright (visual + runtime gates)");
  } else {
    console.log("    \u2717 Playwright (visual + runtime gates): not installed");
    console.log("      \u2192 Run: npm install -g playwright && npx playwright install chromium");
  }

  console.log("");
  console.log("  Get started: forge setup");
  console.log("");
} catch {
  // Non-fatal: summary failure shouldn't block install
}
