import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/loader.js";
import {
  readStatus,
  updateMilestoneStatus,
  findNextPending,
  discoverStatuses,
} from "../state/status.js";
import { readMilestoneSection, buildPrompt } from "./prompt.js";
import {
  createWorktree,
  mergeWorktree,
  removeWorktree,
} from "../worktree/manager.js";
import { ForgeLinearClient } from "../linear/client.js";
import {
  syncMilestoneStart,
  syncMilestoneComplete,
} from "../linear/sync.js";
import type { PipelineResult } from "../types.js";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "cli.js");

function repoName(projectDir: string): string {
  return basename(resolve(projectDir));
}

function worktreePath(projectDir: string, slug: string, milestoneNumber: number): string {
  return resolve(projectDir, "..", ".forge-wt", repoName(projectDir), `${slug}-m${milestoneNumber}`);
}

function parseMilestoneNumber(key: string): number {
  const match = /(\d+)/.exec(key);
  if (!match) throw new Error(`Cannot parse milestone number from key: ${key}`);
  return Number.parseInt(match[1], 10);
}

function parseMilestoneName(key: string): string {
  const colonIndex = key.indexOf(":");
  if (colonIndex === -1) return key;
  return key.slice(colonIndex + 1).trim();
}

function spawnClaude(prompt: string, cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Strip CLAUDECODE env var to allow spawning claude from within a Claude Code session
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", ["-p", "-", "--dangerously-skip-permissions"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function runVerifyInWorktree(wtPath: string): Promise<PipelineResult> {
  try {
    const { stdout } = await execFileAsync("node", [cliPath, "verify", "--json"], {
      cwd: wtPath,
    });
    return JSON.parse(stdout) as PipelineResult;
  } catch (err: unknown) {
    // execFile rejects on non-zero exit, but stdout still contains the JSON result
    if (
      typeof err === "object" &&
      err !== null &&
      "stdout" in err &&
      typeof (err as { stdout: unknown }).stdout === "string"
    ) {
      const stdout = (err as { stdout: string }).stdout;
      if (stdout.trim()) {
        return JSON.parse(stdout) as PipelineResult;
      }
    }
    throw err;
  }
}

export async function runRalphLoop(opts: {
  slug: string;
  projectDir: string;
}): Promise<void> {
  const { slug, projectDir } = opts;
  const config = await loadConfig(projectDir);
  const maxIterations = config.maxIterations;

  // Find the PRD file
  const prdPath = join(projectDir, ".planning", "prds", `${slug}.md`);

  // Get the status for this slug
  const status = await readStatus(projectDir, slug);
  const prdBranch = status.branch;

  // Find all pending milestones and process them in order
  const allStatuses = await discoverStatuses(projectDir);
  let pending = findNextPending(allStatuses.filter((s) => s.slug === slug));

  while (pending.length > 0) {
    const { milestone: milestoneKey } = pending[0];
    const milestoneNumber = parseMilestoneNumber(milestoneKey);
    const milestoneName = parseMilestoneName(milestoneKey);

    console.log(`\n[forge] Starting milestone ${milestoneNumber}: ${milestoneName}`);

    // Mark in_progress
    await updateMilestoneStatus(projectDir, slug, milestoneKey, "in_progress");

    // Linear sync: start
    const apiKey = process.env.LINEAR_API_KEY;
    if (apiKey && status.linearTeamId) {
      try {
        const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
        await syncMilestoneStart(client, config, status, milestoneKey);
      } catch {
        // Linear sync is best-effort
      }
    }

    // Read milestone section from PRD
    const milestoneSection = await readMilestoneSection(prdPath, milestoneNumber);

    // Create worktree
    const wtPath = worktreePath(projectDir, slug, milestoneNumber);
    const wtBranch = `${prdBranch}/m${milestoneNumber}`;
    await createWorktree(wtPath, wtBranch, prdBranch, projectDir);

    let passed = false;
    let verifyErrors: PipelineResult | null = null;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      console.log(`\n[forge] Milestone ${milestoneNumber}, iteration ${iteration}/${maxIterations}`);

      // Build prompt
      const prompt = buildPrompt({
        milestoneName,
        milestoneNumber,
        milestoneSection,
        verifyErrors,
      });

      // Spawn Claude
      await spawnClaude(prompt, wtPath);

      // Run verify
      try {
        const result = await runVerifyInWorktree(wtPath);
        if (result.result === "PASSED") {
          passed = true;
          break;
        }
        verifyErrors = result;
        console.log(`[forge] Verify failed on iteration ${iteration}. Retrying...`);
      } catch (err) {
        // verify itself may exit non-zero; try to parse stderr/stdout
        console.warn(`[forge] Verify execution error on iteration ${iteration}:`, err);
        verifyErrors = null;
      }
    }

    if (!passed) {
      console.error(`\n[forge] Milestone ${milestoneNumber} failed after ${maxIterations} iterations.`);
      await removeWorktree(wtPath, projectDir);
      process.exit(1);
    }

    // Merge back and clean up
    console.log(`\n[forge] Milestone ${milestoneNumber} passed. Merging...`);
    await mergeWorktree(wtBranch, prdBranch, projectDir);
    await removeWorktree(wtPath, projectDir);

    // Update status
    const milestoneKeys = Object.keys(status.milestones);
    const isLast = milestoneKeys.indexOf(milestoneKey) === milestoneKeys.length - 1;
    await updateMilestoneStatus(projectDir, slug, milestoneKey, "complete");

    // Linear sync: complete
    if (apiKey && status.linearTeamId) {
      try {
        const client = new ForgeLinearClient({ apiKey, teamId: status.linearTeamId });
        await syncMilestoneComplete(client, config, status, milestoneKey, isLast);
      } catch {
        // Linear sync is best-effort
      }
    }

    console.log(`[forge] Milestone ${milestoneNumber} complete.`);

    // Refresh pending list for next iteration
    const refreshed = await discoverStatuses(projectDir);
    pending = findNextPending(refreshed.filter((s) => s.slug === slug));
  }

  console.log(`\n[forge] All milestones for "${slug}" complete.`);
}
