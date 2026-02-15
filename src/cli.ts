#!/usr/bin/env node

import { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "./gates/index.js";
import { loadConfig } from "./config/loader.js";
import type { PipelineResult, VerifyCache } from "./types.js";

const program = new Command();

program
  .name("forge")
  .description("forge-cc — verification + workflow CLI for Claude Code agents")
  .version("0.1.0");

program
  .command("verify")
  .description("Run verification gates against the current project")
  .option("--gate <gates>", "Comma-separated list of gates to run (e.g., types,lint,tests)")
  .option("--json", "Output structured JSON instead of human-readable report")
  .option("--prd <path>", "Path to PRD for acceptance criteria matching")
  .action(async (opts) => {
    try {
      const projectDir = process.cwd();
      const config = loadConfig(projectDir);

      const gates = opts.gate ? opts.gate.split(",").map((g: string) => g.trim()) : config.gates;
      const prdPath = opts.prd ?? config.prdPath;

      const result = await runPipeline({
        projectDir,
        gates,
        prdPath,
        maxIterations: config.maxIterations,
        devServerCommand: config.devServer?.command,
        devServerPort: config.devServer?.port,
      });

      // Generate report if pipeline didn't produce one
      if (!result.report) {
        result.report = formatReport(result);
      }

      // Write verify cache (non-fatal if this fails)
      try {
        writeVerifyCache(projectDir, result);
      } catch (cacheErr) {
        const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
        console.error(`Warning: Could not write verify cache: ${msg}`);
      }

      // Output
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result.report);
      }

      process.exit(result.passed ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: forge verify failed — ${message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Print current project state")
  .action(() => {
    const projectDir = process.cwd();

    // Branch
    let branch = "unknown";
    try {
      branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    } catch { /* not a git repo */ }

    console.log(`## Forge Status`);
    console.log(`**Branch:** ${branch}`);

    // Last verify
    const cachePath = join(projectDir, ".forge", "last-verify.json");
    if (existsSync(cachePath)) {
      const cache: VerifyCache = JSON.parse(readFileSync(cachePath, "utf-8"));
      const status = cache.passed ? "PASSED" : "FAILED";
      const age = Math.round((Date.now() - new Date(cache.timestamp).getTime()) / 60_000);
      console.log(`**Last Verify:** ${status} (${age}min ago on ${cache.branch})`);
      for (const gate of cache.gates) {
        const icon = gate.passed ? "[x]" : "[ ]";
        console.log(`  - ${icon} ${gate.gate}: ${gate.passed ? "PASS" : "FAIL"}`);
      }
    } else {
      console.log(`**Last Verify:** none`);
    }

    // Config
    const configPath = join(projectDir, ".forge.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      console.log(`**Config:** .forge.json (gates: ${config.gates?.join(", ") ?? "default"})`);
    } else {
      console.log(`**Config:** auto-detected (no .forge.json)`);
    }
  });

function writeVerifyCache(projectDir: string, result: PipelineResult): void {
  const forgeDir = join(projectDir, ".forge");
  mkdirSync(forgeDir, { recursive: true });

  let branch = "unknown";
  try {
    branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
  } catch { /* not a git repo */ }

  const cache: VerifyCache = {
    passed: result.passed,
    timestamp: new Date().toISOString(),
    gates: result.gates,
    branch,
  };

  writeFileSync(join(forgeDir, "last-verify.json"), JSON.stringify(cache, null, 2));
}

function formatReport(result: PipelineResult): string {
  const lines: string[] = [];
  const status = result.passed ? "PASSED" : "FAILED";
  lines.push("## Verification Report");
  lines.push(`**Status:** ${status}`);

  const totalMs = result.gates.reduce((sum, g) => sum + g.duration_ms, 0);
  lines.push(`**Duration:** ${(totalMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push("### Gates");

  for (const gate of result.gates) {
    const icon = gate.passed ? "[x]" : "[ ]";
    const dur = `${(gate.duration_ms / 1000).toFixed(1)}s`;
    let suffix = "";
    if (!gate.passed && gate.errors.length > 0) {
      suffix = ` — ${gate.errors.length} error${gate.errors.length === 1 ? "" : "s"}`;
    }
    lines.push(`- ${icon} ${gate.gate}: ${gate.passed ? "PASS" : "FAIL"} (${dur})${suffix}`);
  }

  // Errors detail section
  const withErrors = result.gates.filter(g => g.errors.length > 0);
  if (withErrors.length > 0) {
    lines.push("");
    lines.push("### Errors");
    for (const gate of withErrors) {
      lines.push(`#### ${gate.gate}`);
      for (const err of gate.errors) {
        const loc = err.file ? `${err.file}${err.line ? `:${err.line}` : ""}` : "";
        lines.push(`- ${loc ? `${loc}: ` : ""}${err.message}`);
      }
    }
  }

  return lines.join("\n");
}

program.parse();
