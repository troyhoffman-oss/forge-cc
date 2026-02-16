#!/usr/bin/env node

import { Command } from "commander";
import { execSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./gates/index.js";
import { loadConfig } from "./config/loader.js";
import {
  forgeConfigTemplate,
  claudeMdTemplate,
  stateMdTemplate,
  roadmapMdTemplate,
  lessonsMdTemplate,
  globalClaudeMdTemplate,
  gitignoreForgeLines,
  type SetupContext,
} from "./setup/templates.js";
import type { PipelineResult, VerifyCache } from "./types.js";
import { loadRegistry, detectStaleSessions, deregisterSession } from "./worktree/session.js";
import { countPendingMilestones } from "./go/auto-chain.js";
import { getRepoRoot, cleanupStaleWorktrees } from "./worktree/manager.js";
import { formatSessionsReport } from "./reporter/human.js";

const program = new Command();

program
  .name("forge")
  .description("forge-cc — verification + workflow CLI for Claude Code agents")
  .version("0.1.7");

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

    // Last verify — try per-branch first, fall back to old path
    const perBranchCachePath = getVerifyCachePath(projectDir, branch);
    const legacyCachePath = join(projectDir, ".forge", "last-verify.json");
    const cachePath = existsSync(perBranchCachePath)
      ? perBranchCachePath
      : legacyCachePath;
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

    // Sessions
    try {
      const repoRoot = getRepoRoot(projectDir);
      detectStaleSessions(repoRoot);
      const registry = loadRegistry(repoRoot);
      if (registry.sessions.length > 0) {
        console.log("");
        console.log(formatSessionsReport(registry.sessions));
      }
    } catch {
      // Not a git repo or no session registry — skip silently
    }
  });

// ── Skill installation helper ──────────────────────────────────────

function getPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function installSkills(): string[] {
  const skillsDir = join(getPackageRoot(), "skills");
  const targetDir = join(homedir(), ".claude", "commands", "forge");
  mkdirSync(targetDir, { recursive: true });

  const installed: string[] = [];
  const files = readdirSync(skillsDir).filter(
    (f) => f.startsWith("forge-") && f.endsWith(".md"),
  );

  for (const file of files) {
    const targetName = file.replace(/^forge-/, "");
    copyFileSync(join(skillsDir, file), join(targetDir, targetName));
    installed.push(targetName);
  }

  return installed;
}

// ── setup command ──────────────────────────────────────────────────

program
  .command("setup")
  .description("Initialize forge project and install skills")
  .option("--skills-only", "Only install skills to ~/.claude/commands/forge/")
  .action((opts) => {
    // Always install skills
    const installed = installSkills();
    console.log(`Installed ${installed.length} skills to ~/.claude/commands/forge/`);
    for (const s of installed) {
      console.log(`  - ${s}`);
    }

    if (opts.skillsOnly) {
      return;
    }

    // Check if project already initialized
    const projectDir = process.cwd();
    if (existsSync(join(projectDir, ".forge.json"))) {
      console.log(
        "\nProject already initialized. Run `/forge:setup` to refresh.",
      );
      return;
    }

    // Scaffold project files
    const projectName = basename(projectDir);
    const ctx: SetupContext = {
      projectName,
      techStack: "TypeScript, Node.js",
      description: "Project description — customize in CLAUDE.md",
      gates: ["types", "lint", "tests"],
      date: new Date().toISOString().split("T")[0],
    };

    mkdirSync(join(projectDir, ".planning"), { recursive: true });
    mkdirSync(join(projectDir, "tasks"), { recursive: true });

    writeFileSync(join(projectDir, ".forge.json"), forgeConfigTemplate(ctx));
    writeFileSync(join(projectDir, "CLAUDE.md"), claudeMdTemplate(ctx));
    writeFileSync(
      join(projectDir, ".planning", "STATE.md"),
      stateMdTemplate(ctx),
    );
    writeFileSync(
      join(projectDir, ".planning", "ROADMAP.md"),
      roadmapMdTemplate(ctx),
    );
    writeFileSync(
      join(projectDir, "tasks", "lessons.md"),
      lessonsMdTemplate(ctx),
    );

    // Append to .gitignore
    const gitignorePath = join(projectDir, ".gitignore");
    const forgeLines = gitignoreForgeLines();
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".forge/")) {
        writeFileSync(gitignorePath, content + "\n" + forgeLines);
      }
    } else {
      writeFileSync(gitignorePath, forgeLines);
    }

    // Create global CLAUDE.md if needed
    const globalClaudeMdPath = join(homedir(), ".claude", "CLAUDE.md");
    if (!existsSync(globalClaudeMdPath)) {
      mkdirSync(dirname(globalClaudeMdPath), { recursive: true });
      writeFileSync(globalClaudeMdPath, globalClaudeMdTemplate());
      console.log("\nCreated ~/.claude/CLAUDE.md");
    }

    console.log(`\n## Forge Setup Complete`);
    console.log(`**Project:** ${projectName}`);
    console.log(`**Gates:** ${ctx.gates.join(", ")}`);
    console.log(`\nFiles created:`);
    console.log(`  - .forge.json`);
    console.log(`  - CLAUDE.md`);
    console.log(`  - .planning/STATE.md`);
    console.log(`  - .planning/ROADMAP.md`);
    console.log(`  - tasks/lessons.md`);
    console.log(`  - .gitignore (forge lines)`);
    console.log(`\nNext: Review CLAUDE.md, then run \`npx forge verify\``);
  });

// ── update command ─────────────────────────────────────────────────

program
  .command("update")
  .description("Check for updates and install latest forge-cc")
  .action(() => {
    // Get current version from our own package.json
    const pkgPath = join(getPackageRoot(), "package.json");
    const currentVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version;

    // Get latest version from npm registry
    let latestVersion: string;
    try {
      latestVersion = execSync("npm view forge-cc version", {
        encoding: "utf-8",
      }).trim();
    } catch {
      console.error(
        "Could not reach npm registry. Check your internet connection.",
      );
      process.exit(1);
    }

    console.log(`## Forge Version Check\n`);
    console.log(`**Installed:** v${currentVersion}`);
    console.log(`**Latest:** v${latestVersion}`);

    if (currentVersion === latestVersion) {
      console.log(`**Status:** Up to date\n`);
      console.log("You're on the latest version.");
      return;
    }

    console.log(`**Status:** Update available\n`);
    console.log(`Updating forge-cc to v${latestVersion}...`);

    try {
      execSync("npm install -g forge-cc@latest", { stdio: "inherit" });
    } catch {
      console.error(
        "Update failed. Try manually: npm install -g forge-cc@latest",
      );
      process.exit(1);
    }

    // Re-sync skills after update
    const installed = installSkills();
    console.log(
      `\nSynced ${installed.length} skills to ~/.claude/commands/forge/`,
    );

    console.log(`\n## Update Complete`);
    console.log(`**Previous:** v${currentVersion}`);
    console.log(`**Current:** v${latestVersion}`);

    if (existsSync(join(process.cwd(), ".forge.json"))) {
      console.log(
        `\nConsider running \`/forge:setup\` (Refresh) to update project files.`,
      );
    }
  });

// ── cleanup command ────────────────────────────────────────────────

program
  .command("cleanup")
  .description("Remove stale worktrees, deregister dead sessions, reclaim disk space")
  .action(() => {
    let repoRoot: string;
    try {
      repoRoot = getRepoRoot(process.cwd());
    } catch {
      console.error("Error: not a git repository. Run this from inside a git project.");
      process.exit(1);
      return; // unreachable but helps TypeScript narrow
    }

    console.log("## Forge Cleanup\n");

    // Detect and mark stale sessions (mutates registry)
    detectStaleSessions(repoRoot);

    // Load registry and filter for stale sessions
    const registry = loadRegistry(repoRoot);
    const staleSessions = registry.sessions.filter((s) => s.status === "stale");

    if (staleSessions.length === 0) {
      console.log("No stale sessions found. Nothing to clean up.");
      return;
    }

    console.log(`Found ${staleSessions.length} stale session${staleSessions.length === 1 ? "" : "s"}.\n`);

    // Remove worktrees
    const result = cleanupStaleWorktrees(repoRoot, staleSessions);

    // Deregister successfully removed sessions and print results
    for (const removed of result.removed) {
      deregisterSession(repoRoot, removed.sessionId);
      console.log(`- Removed: ${removed.sessionId} (${removed.branch}) — worktree deleted`);
    }

    for (const err of result.errors) {
      console.log(`- Error: ${err.sessionId} — ${err.error}`);
    }

    // Summary
    const cleanedCount = result.removed.length;
    const errorCount = result.errors.length;
    console.log("");
    if (errorCount === 0) {
      console.log(`Cleaned up ${cleanedCount} session${cleanedCount === 1 ? "" : "s"}.`);
    } else {
      console.log(`Cleaned up ${cleanedCount} session${cleanedCount === 1 ? "" : "s"}, ${errorCount} error${errorCount === 1 ? "" : "s"}.`);
    }
  });

// ── run command ────────────────────────────────────────────────────

program
  .command("run")
  .description(
    "Execute all remaining milestones autonomously in fresh Claude sessions (Ralph Loop pattern)",
  )
  .option(
    "--max-iterations <n>",
    "Maximum iterations before stopping (safety cap)",
    "20",
  )
  .action(async (opts) => {
    const projectDir = process.cwd();
    const maxIterations = parseInt(opts.maxIterations, 10);

    // Pre-flight: check ROADMAP.md exists
    const roadmapPath = join(projectDir, ".planning", "ROADMAP.md");
    if (!existsSync(roadmapPath)) {
      console.error(
        "Error: No .planning/ROADMAP.md found. Run /forge:spec first to create a PRD with milestones.",
      );
      process.exit(1);
    }

    // Pre-flight: check pending milestones
    let pending = await countPendingMilestones(projectDir);
    if (pending === 0) {
      console.log("All milestones complete! Nothing to run.");
      console.log(
        'Create a PR with `gh pr create` or run `/forge:spec` to start a new project.',
      );
      process.exit(0);
    }

    // Banner
    console.log("## Forge Auto-Chain (Ralph Loop)\n");
    console.log(`**Milestones remaining:** ${pending}`);
    console.log(`**Max iterations:** ${maxIterations}`);
    console.log(`**Stop:** Ctrl+C\n`);
    console.log(
      "Each milestone runs in a fresh Claude session with full /forge:go pipeline.",
    );
    console.log("Output streams inline below.\n");
    console.log("---\n");

    const prompt = [
      "You are executing one milestone of a forge auto-chain.",
      'Use the Skill tool: skill="forge:go", args="--single"',
      "After the skill completes, stop.",
    ].join("\n");

    for (let i = 0; i < maxIterations; i++) {
      const iteration = i + 1;
      console.log(`\n=== Iteration ${iteration} (${pending} milestones remaining) ===\n`);

      const result = spawnSync(
        "claude",
        ["-p", prompt, "--dangerously-skip-permissions"],
        {
          stdio: "inherit",
          cwd: projectDir,
        },
      );

      // Check exit code
      if (result.status !== 0) {
        console.error(
          `\nError: Claude session exited with code ${result.status ?? "unknown"}. Stopping.`,
        );
        console.log("Fix the issue, then run `npx forge run` again to resume.");
        process.exit(1);
      }

      // Check pending count (stall detection)
      const newPending = await countPendingMilestones(projectDir);

      if (newPending === 0) {
        console.log("\n---\n");
        console.log("## All Milestones Complete!\n");
        console.log(
          `Completed in ${iteration} iteration${iteration === 1 ? "" : "s"}.`,
        );
        console.log(
          'Create a PR with `gh pr create` or run `/forge:spec` to start a new project.',
        );
        process.exit(0);
      }

      if (newPending >= pending) {
        console.error(
          `\nStall detected: pending count did not decrease (was ${pending}, now ${newPending}). Stopping.`,
        );
        console.log("Fix the issue, then run `npx forge run` again to resume.");
        process.exit(1);
      }

      pending = newPending;
    }

    console.error(
      `\nReached max iterations (${maxIterations}). Stopping.`,
    );
    console.log(
      `${pending} milestone${pending === 1 ? "" : "s"} remaining. Run \`npx forge run\` again to continue.`,
    );
    process.exit(1);
  });

// ── helpers ────────────────────────────────────────────────────────

/**
 * Get the verify cache path for the current branch.
 * Returns: .forge/verify-cache/<branch-slug>.json
 */
function getVerifyCachePath(projectDir: string, branch?: string): string {
  let branchName = branch;
  if (!branchName) {
    try {
      branchName = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
    } catch {
      branchName = "unknown";
    }
  }
  const slug = branchName.replace(/\//g, "-").toLowerCase();
  return join(projectDir, ".forge", "verify-cache", `${slug}.json`);
}

function writeVerifyCache(projectDir: string, result: PipelineResult): void {
  let branch = "unknown";
  try {
    branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
  } catch { /* not a git repo */ }

  const cachePath = getVerifyCachePath(projectDir, branch);
  mkdirSync(dirname(cachePath), { recursive: true });

  const cache: VerifyCache = {
    passed: result.passed,
    timestamp: new Date().toISOString(),
    gates: result.gates,
    branch,
  };

  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
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
