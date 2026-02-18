#!/usr/bin/env node

import { Command } from "commander";
import { execSync, spawn, spawnSync } from "node:child_process";
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
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { runPipeline, captureBeforeSnapshots, clearBeforeSnapshots } from "./gates/index.js";
import { closeBrowser } from "./utils/browser.js";
import { loadConfig } from "./config/loader.js";
import {
  forgeConfigTemplate,
  claudeMdTemplate,
  lessonsMdTemplate,
  globalClaudeMdTemplate,
  gitignoreForgeLines,
  type SetupContext,
} from "./setup/templates.js";
import type { PipelineResult, VerifyCache } from "./types.js";
import { loadRegistry, detectStaleSessions, deregisterSession } from "./worktree/session.js";
import { countPendingMilestones } from "./go/auto-chain.js";
import { discoverPRDs } from "./state/prd-status.js";
import { PRDQueue } from "./go/prd-queue.js";
import { getRepoRoot, cleanupStaleWorktrees, cleanupMergedBranches } from "./worktree/manager.js";
import { formatSessionsReport } from "./reporter/human.js";

const __filename_cli = fileURLToPath(import.meta.url);
const __dirname_cli = dirname(__filename_cli);
const cliPkgVersion = JSON.parse(
  readFileSync(join(__dirname_cli, "..", "package.json"), "utf-8"),
).version as string;

const program = new Command();

program
  .name("forge")
  .description("forge-cc — verification + workflow CLI for Claude Code agents")
  .version(cliPkgVersion);

program
  .command("verify")
  .description("Run verification gates against the current project")
  .option("--gate <gates>", "Comma-separated list of gates to run (e.g., types,lint,tests)")
  .option("--json", "Output structured JSON instead of human-readable report")
  .option("--prd <path>", "Path to PRD for acceptance criteria matching")
  .option("--before-only", "Capture visual baseline screenshots and exit (no verification)")
  .option("--after-only", "Run visual verification comparing against stored baseline")
  .action(async (opts) => {
    try {
      const projectDir = process.cwd();
      const config = loadConfig(projectDir);
      const appDir = config.appDir ? resolve(projectDir, config.appDir) : undefined;
      const targetDir = appDir ?? projectDir;
      const pages = config.pages ?? ["/"];

      // --before-only: capture baseline screenshots to disk and exit
      if (opts.beforeOnly) {
        console.log("Capturing visual baseline screenshots...");
        try {
          await captureBeforeSnapshots(targetDir, pages, {
            devServerCommand: config.devServer?.command,
            devServerPort: config.devServer?.port,
          });
          console.log(`Visual baseline captured for ${pages.length} page(s): ${pages.join(", ")}`);
          console.log("Snapshots saved to .forge/screenshots/before/");
          process.exit(0);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: Visual baseline capture failed — ${message}`);
          process.exit(1);
        } finally {
          try { await closeBrowser(); } catch { /* non-fatal */ }
        }
        return;
      }

      // --after-only: run only the visual gate (comparison against stored baseline)
      if (opts.afterOnly) {
        const { verifyVisual } = await import("./gates/visual-gate.js");
        console.log("Running visual verification against baseline...");
        try {
          const result = await verifyVisual(targetDir, pages, {
            devServerCommand: config.devServer?.command,
            devServerPort: config.devServer?.port,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const status = result.passed ? "PASSED" : "FAILED";
            console.log(`Visual gate: ${status}`);
            if (result.warnings.length > 0) {
              for (const w of result.warnings) console.log(`  Warning: ${w}`);
            }
            if (result.errors.length > 0) {
              for (const e of result.errors) console.log(`  Error: ${e.message}`);
            }
            if (result.screenshots.length > 0) {
              console.log(`Screenshots saved to .forge/screenshots/after/`);
            }
          }

          process.exit(result.passed ? 0 : 1);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: Visual verification failed — ${message}`);
          process.exit(1);
        } finally {
          try { await closeBrowser(); } catch { /* non-fatal */ }
        }
        return;
      }

      // Standard verify: run the full pipeline
      const gates = opts.gate ? opts.gate.split(",").map((g: string) => g.trim()) : config.gates;
      const prdPath = opts.prd ?? config.prdPath;

      const result = await runPipeline({
        projectDir,
        appDir,
        gates,
        prdPath,
        pages: config.pages,
        maxIterations: config.maxIterations,
        devServerCommand: config.devServer?.command,
        devServerPort: config.devServer?.port,
        reviewBlocking: config.review?.blocking,
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
  .action(async () => {
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

    // Per-PRD status
    try {
      const prds = await discoverPRDs(projectDir);
      if (prds.length > 0) {
        console.log("");
        console.log("### PRDs");
        for (const prd of prds) {
          const milestones = Object.entries(prd.status.milestones);
          const complete = milestones.filter(([, m]) => m.status === "complete").length;
          const total = milestones.length;
          console.log(`- **${prd.slug}** (${prd.status.branch}): ${complete}/${total} milestones complete`);
        }
      }
    } catch { /* prd-status not available */ }
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
  .option("--with-visual", "Auto-install Playwright without prompting")
  .option("--skip-deps", "Skip optional dependency checks")
  .action(async (opts) => {
    // Always install skills
    const installed = installSkills();
    console.log(`Installed ${installed.length} skills to ~/.claude/commands/forge/`);
    for (const s of installed) {
      console.log(`  - ${s}`);
    }

    if (opts.skillsOnly) {
      return;
    }

    // Optional dependency check
    if (!opts.skipDeps) {
      const checks = await checkEnvironment();
      const playwrightCheck = checks.find((c) => c.name === "Playwright");
      const playwrightMissing = playwrightCheck?.status !== "ok";

      console.log("\n## Environment\n");
      for (const check of checks) {
        if (check.status === "ok") {
          const ver = check.version ? ` ${check.version}` : "";
          const extra = check.detail ? ` (${check.detail})` : "";
          console.log(`  \u2713 ${check.name}${ver}${extra}`);
        } else {
          const msg = check.message ? ` \u2014 ${check.message}` : "";
          console.log(`  \u2717 ${check.name}${msg}`);
          if (check.fix) {
            console.log(`    \u2192 ${check.fix}`);
          }
        }
      }
      console.log("");

      if (playwrightMissing) {
        let shouldInstall = false;

        if (opts.withVisual) {
          shouldInstall = true;
        } else if (process.stdout.isTTY) {
          shouldInstall = await askYesNo(
            "Playwright enables visual regression + runtime testing. Install now? (Y/n): ",
          );
        }

        if (shouldInstall) {
          console.log("\nInstalling Playwright + Chromium...\n");
          try {
            execSync("npm install -g playwright && npx playwright install chromium", {
              stdio: "inherit",
            });
            console.log("\nPlaywright installed successfully.");
          } catch {
            console.error(
              "\nPlaywright installation failed. Run manually:\n  npm install -g playwright && npx playwright install chromium",
            );
          }
        }
      }
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
      console.log("No stale sessions found.");
    } else {
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
    }

    // Clean up branches whose remote tracking branch is gone (PR merged)
    const branchResult = cleanupMergedBranches(repoRoot);
    if (branchResult.deleted.length > 0) {
      console.log(`\nDeleted ${branchResult.deleted.length} merged branch${branchResult.deleted.length === 1 ? "" : "es"}:`);
      for (const branch of branchResult.deleted) {
        console.log(`  - ${branch}`);
      }
    }
    if (branchResult.errors.length > 0) {
      for (const err of branchResult.errors) {
        console.log(`  - Error deleting ${err.branch}: ${err.error}`);
      }
    }
  });

// ── linear-sync command ────────────────────────────────────────────

const linearSync = program
  .command("linear-sync")
  .description("Sync milestone state with Linear (programmatic)");

linearSync
  .command("start")
  .description("Transition milestone issues and project to In Progress")
  .requiredOption("--slug <slug>", "PRD slug")
  .requiredOption("--milestone <number>", "Milestone number")
  .action(async (opts) => {
    const { cliSyncStart } = await import("./go/linear-sync-cli.js");
    const projectDir = process.cwd();
    const milestoneNumber = parseInt(opts.milestone, 10);
    const result = await cliSyncStart(projectDir, opts.slug, milestoneNumber);
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
  });

linearSync
  .command("complete")
  .description("Transition milestone issues and project on completion")
  .requiredOption("--slug <slug>", "PRD slug")
  .requiredOption("--milestone <number>", "Milestone number")
  .option("--last", "This is the last milestone (transition to In Review)")
  .option("--pr-url <url>", "PR URL to attach as comments")
  .action(async (opts) => {
    const { cliSyncComplete } = await import("./go/linear-sync-cli.js");
    const projectDir = process.cwd();
    const milestoneNumber = parseInt(opts.milestone, 10);
    const isLastMilestone = opts.last === true;
    const result = await cliSyncComplete(
      projectDir,
      opts.slug,
      milestoneNumber,
      isLastMilestone,
      opts.prUrl,
    );
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
  });

linearSync
  .command("list-issues")
  .description("List all Linear issue identifiers for a project")
  .requiredOption("--slug <slug>", "PRD slug")
  .action(async (opts) => {
    const { cliFetchIssueIdentifiers } = await import("./go/linear-sync-cli.js");
    const projectDir = process.cwd();
    const result = await cliFetchIssueIdentifiers(projectDir, opts.slug);
    if (result) {
      console.log(JSON.stringify(result.identifiers));
    }
  });

linearSync
  .command("done")
  .description("Transition all project issues and the project to Done (post-merge)")
  .requiredOption("--slug <slug>", "PRD slug")
  .action(async (opts) => {
    const { cliSyncDone } = await import("./go/linear-sync-cli.js");
    const projectDir = process.cwd();
    const result = await cliSyncDone(projectDir, opts.slug);
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
  });

// ── doctor command ─────────────────────────────────────────────────

program
  .command("doctor")
  .description("Check environment health and optional dependency status")
  .action(async () => {
    const checks = await checkEnvironment();

    console.log("## Forge Environment\n");
    for (const check of checks) {
      if (check.status === "ok") {
        const ver = check.version ? ` ${check.version}` : "";
        const extra = check.detail ? ` (${check.detail})` : "";
        console.log(`  \u2713 ${check.name}${ver}${extra}`);
      } else {
        const msg = check.message ? ` \u2014 ${check.message}` : "";
        console.log(`  \u2717 ${check.name}${msg}`);
        if (check.fix) {
          console.log(`    \u2192 ${check.fix}`);
        }
      }
    }

    const issues = checks.filter((c) => c.status !== "ok");
    console.log("");
    if (issues.length === 0) {
      console.log("All checks passed.");
      process.exit(0);
    } else {
      console.log(
        `${issues.length} issue${issues.length === 1 ? "" : "s"} found. Run the commands above to fix.`,
      );
      process.exit(1);
    }
  });

// ── Claude session runner (stream-json for real-time output) ─────

interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      text?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string;
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
}

function runClaudeSession(
  prompt: string,
  cwd: string,
): Promise<{ exitCode: number; result?: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    // Pass prompt as CLI argument (not stdin) — matches Ralphy pattern
    const child = spawn(
      "claude",
      [
        "-p",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--verbose",
        prompt,
      ],
      { stdio: ["ignore", "pipe", "inherit"], cwd, env },
    );

    let buffer = "";
    let finalResult: string | undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: StreamEvent;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }

        if (evt.type === "assistant" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "text" && block.text) {
              process.stdout.write(block.text);
            } else if (block.type === "tool_use" && block.name) {
              const summary = formatToolInput(block.name, block.input);
              process.stdout.write(`  [${block.name}] ${summary}\n`);
            }
          }
        } else if (evt.type === "result") {
          finalResult = evt.result;
          const turns = evt.num_turns ?? 0;
          const cost = evt.total_cost_usd
            ? `$${evt.total_cost_usd.toFixed(2)}`
            : "";
          const dur = evt.duration_ms
            ? `${Math.round(evt.duration_ms / 1000)}s`
            : "";
          const parts = [
            `${turns} turns`,
            dur,
            cost,
          ].filter(Boolean);
          console.log(`\n--- Session complete (${parts.join(", ")}) ---`);
          if (evt.is_error) {
            console.error("Session ended with error.");
          }
        }
      }
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, result: finalResult });
    });
  });
}

function formatToolInput(
  name: string,
  input?: Record<string, unknown>,
): string {
  if (!input) return "";
  switch (name) {
    case "Read":
      return String(input.file_path ?? "");
    case "Write":
      return String(input.file_path ?? "");
    case "Edit":
      return String(input.file_path ?? "");
    case "Bash":
      return String(input.command ?? "").substring(0, 120);
    case "Glob":
      return String(input.pattern ?? "");
    case "Grep":
      return String(input.pattern ?? "");
    case "Skill":
      return `${input.skill ?? ""}${input.args ? " " + input.args : ""}`;
    case "TeamCreate":
      return String(input.team_name ?? "");
    case "TeamDelete":
      return "";
    case "SendMessage":
      return `→ ${input.recipient ?? "all"}: ${String(input.summary ?? "").substring(0, 80)}`;
    case "Task":
      return String(input.description ?? "").substring(0, 80);
    case "TaskUpdate":
      return `#${input.taskId ?? ""} → ${input.status ?? ""}`;
    default:
      return JSON.stringify(input).substring(0, 100);
  }
}

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
  .option("--prd <slug>", "Run milestones for a specific PRD")
  .option("--all", "Run all PRDs with pending milestones (parallel worktrees for independent PRDs)")
  .action(async (opts) => {
    const projectDir = process.cwd();
    const maxIterations = parseInt(opts.maxIterations, 10);

    // Pre-flight: check for PRD status files
    const prds = await discoverPRDs(projectDir);
    if (prds.length === 0) {
      console.error("Error: No PRD status files found in .planning/status/. Run /forge:spec first.");
      process.exit(1);
    }

    // --all mode: run all PRDs with pending milestones
    if (opts.all) {
      const queue = new PRDQueue(projectDir);
      const readyPRDs = await queue.getReadyPRDs();

      if (readyPRDs.length === 0) {
        console.log("All PRDs complete! Nothing to run.");
        console.log(
          'Create a PR with `gh pr create` or run `/forge:spec` to start a new project.',
        );
        process.exit(0);
      }

      console.log("## Forge Multi-PRD Auto-Chain\n");
      console.log(`**PRDs with pending milestones:** ${readyPRDs.length}`);
      console.log(`**Max iterations per PRD:** ${maxIterations}`);
      console.log(`**Stop:** Ctrl+C\n`);

      // Display per-PRD status
      console.log("### PRD Queue");
      for (const entry of readyPRDs) {
        const next = entry.nextMilestone !== null ? `next: M${entry.nextMilestone}` : "none pending";
        console.log(`- **${entry.slug}** (${entry.branch}): ${entry.pendingMilestones} pending, ${next}`);
      }
      console.log("");

      // Run each PRD sequentially (each PRD runs its milestones in order)
      for (const entry of readyPRDs) {
        console.log(`\n--- Running PRD: ${entry.slug} ---\n`);

        let prdPending = entry.pendingMilestones;
        const prompt = [
          "You are executing one milestone of a forge auto-chain.",
          `Use the Skill tool: skill="forge:go", args="--single --prd ${entry.slug}"`,
          "After the skill completes, stop.",
        ].join("\n");

        for (let i = 0; i < maxIterations && prdPending > 0; i++) {
          const iteration = i + 1;
          console.log(`\n=== ${entry.slug} — Iteration ${iteration} (${prdPending} milestones remaining) ===\n`);

          const { exitCode } = await runClaudeSession(prompt, projectDir);

          if (exitCode !== 0) {
            console.error(
              `\nError: Claude session for ${entry.slug} exited with code ${exitCode}. Skipping to next PRD.`,
            );
            break;
          }

          const newPending = await countPendingMilestones(projectDir, entry.slug);

          if (newPending === 0) {
            console.log(`\n${entry.slug}: All milestones complete!`);
            break;
          }

          if (newPending >= prdPending) {
            console.error(
              `\nStall detected for ${entry.slug}: pending count did not decrease (was ${prdPending}, now ${newPending}). Skipping to next PRD.`,
            );
            break;
          }

          prdPending = newPending;
        }
      }

      // Final summary
      console.log("\n---\n");
      console.log("## Multi-PRD Run Summary\n");
      const allEntries = await queue.scanPRDs();
      for (const entry of allEntries) {
        const status = entry.pendingMilestones === 0 ? "COMPLETE" : `${entry.pendingMilestones} pending`;
        console.log(`- **${entry.slug}**: ${status}`);
      }

      const totalPending = allEntries.reduce((sum, e) => sum + e.pendingMilestones, 0);
      if (totalPending === 0) {
        console.log("\nAll PRDs complete!");
      } else {
        console.log(`\n${totalPending} milestone${totalPending === 1 ? "" : "s"} remaining across all PRDs.`);
      }

      process.exit(totalPending === 0 ? 0 : 1);
      return;
    }

    // Single PRD mode (existing behavior)
    // Validate --prd slug if provided
    if (opts.prd) {
      const slugExists = prds.some((p) => p.slug === opts.prd);
      if (!slugExists) {
        console.error(`Error: PRD "${opts.prd}" not found. Available PRDs: ${prds.map((p) => p.slug).join(", ")}`);
        process.exit(1);
      }
    }

    // Pre-flight: check pending milestones
    let pending = await countPendingMilestones(projectDir, opts.prd);
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

    const skillArgs = opts.prd ? `--single --prd ${opts.prd}` : "--single";
    const prompt = [
      "You are executing one milestone of a forge auto-chain.",
      `Use the Skill tool: skill="forge:go", args="${skillArgs}"`,
      "After the skill completes, stop.",
    ].join("\n");

    for (let i = 0; i < maxIterations; i++) {
      const iteration = i + 1;
      console.log(`\n=== Iteration ${iteration} (${pending} milestones remaining) ===\n`);

      const { exitCode } = await runClaudeSession(prompt, projectDir);

      // Check exit code
      if (exitCode !== 0) {
        console.error(
          `\nError: Claude session exited with code ${exitCode}. Stopping.`,
        );
        console.log("Fix the issue, then run `npx forge run` again to resume.");
        process.exit(1);
      }

      // Check pending count (stall detection)
      const newPending = await countPendingMilestones(projectDir, opts.prd);

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

// ── environment check helpers ──────────────────────────────────────

interface EnvCheck {
  name: string;
  status: "ok" | "missing" | "error";
  version?: string;
  detail?: string;
  message?: string;
  fix?: string;
}

async function checkEnvironment(): Promise<EnvCheck[]> {
  const checks: EnvCheck[] = [];

  // forge-cc
  checks.push({ name: "forge-cc", status: "ok", version: `v${cliPkgVersion}` });

  // Node.js
  checks.push({ name: "Node.js", status: "ok", version: process.version });

  // git
  try {
    const gitOut = execSync("git --version", { encoding: "utf-8", stdio: "pipe" }).trim();
    checks.push({ name: "git", status: "ok", version: gitOut.replace("git version ", "") });
  } catch {
    checks.push({
      name: "git",
      status: "missing",
      message: "not installed",
      fix: "Install git: https://git-scm.com/",
    });
  }

  // gh CLI + auth
  try {
    const ghOut = execSync("gh --version", { encoding: "utf-8", stdio: "pipe" }).trim().split("\n")[0];
    const ghVersion = ghOut.replace(/^gh version\s+/, "").split(" ")[0];

    let authenticated = false;
    try {
      execSync("gh auth status", { encoding: "utf-8", stdio: "pipe" });
      authenticated = true;
    } catch {
      // not authenticated
    }

    if (authenticated) {
      checks.push({ name: "gh CLI", status: "ok", version: ghVersion, detail: "authenticated" });
    } else {
      checks.push({ name: "gh CLI", status: "ok", version: ghVersion });
      checks.push({
        name: "gh auth",
        status: "error",
        message: "not authenticated",
        fix: "gh auth login",
      });
    }
  } catch {
    checks.push({
      name: "gh CLI",
      status: "missing",
      message: "not installed",
      fix: "Install gh: https://cli.github.com/",
    });
  }

  // Playwright
  let playwrightAvailable = false;
  try {
    await import("playwright");
    playwrightAvailable = true;
    checks.push({ name: "Playwright", status: "ok" });
  } catch {
    checks.push({
      name: "Playwright",
      status: "missing",
      message: "not installed",
      fix: "npm install -g playwright && npx playwright install chromium",
    });
  }

  // Chromium browser
  if (playwrightAvailable) {
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      await browser.close();
      checks.push({ name: "Chromium browser", status: "ok" });
    } catch {
      checks.push({
        name: "Chromium browser",
        status: "missing",
        message: "not installed",
        fix: "npx playwright install chromium",
      });
    }
  } else {
    checks.push({
      name: "Chromium browser",
      status: "missing",
      message: "not installed",
      fix: "npx playwright install chromium",
    });
  }

  return checks;
}

function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "" || trimmed === "y" || trimmed === "yes");
    });
  });
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
