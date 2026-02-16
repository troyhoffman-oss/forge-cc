import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "..", "dist", "cli.js");

if (existsSync(cliPath)) {
  try {
    execFileSync(process.execPath, [cliPath, "setup", "--skills-only"], { stdio: "inherit" });
  } catch {
    // Non-fatal: skill sync failure shouldn't block install
  }
}
