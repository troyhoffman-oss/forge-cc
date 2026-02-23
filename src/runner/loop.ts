import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/loader.js";
import { buildRequirementPrompt } from "./prompt.js";
import {
  createWorktree,
  mergeWorktree,
  removeWorktree,
} from "../worktree/manager.js";
import { ForgeLinearClient } from "../linear/client.js";
import { syncRequirementStart } from "../linear/sync.js";
import { loadIndex, loadOverview, loadRequirement, loadRequirements } from "../graph/reader.js";
import { updateRequirementStatus } from "../graph/writer.js";
import { findReady, isProjectComplete, buildRequirementContext, getTransitiveDeps } from "../graph/query.js";
import type { PipelineResult } from "../types.js";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "cli.js");

function repoName(projectDir: string): string {
  return basename(resolve(projectDir));
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

export async function runGraphLoop(opts: {
  slug: string;
  projectDir: string;
}): Promise<void> {
  const { slug, projectDir } = opts;
  const config = await loadConfig(projectDir);
  const maxIterations = config.maxIterations;

  // Load the graph
  let index = await loadIndex(projectDir, slug);
  const baseBranch = index.branch;

  while (!isProjectComplete(index)) {
    const ready = findReady(index);
    if (ready.length === 0) {
      console.error("\n[forge] No ready requirements but project incomplete — possible deadlock");
      process.exit(1);
    }

    // Execute requirements sequentially (parallel waves are a future enhancement)
    for (const reqId of ready) {
      console.log(`\n[forge] Starting requirement ${reqId}`);

      // Mark in_progress
      index = await updateRequirementStatus(projectDir, slug, reqId, "in_progress");

      const apiKey = process.env.LINEAR_API_KEY;

      // Load requirement content + overview + dependency context
      const req = await loadRequirement(projectDir, slug, reqId);
      if (!req) {
        console.error(`[forge] Requirement file not found for ${reqId}`);
        process.exit(1);
      }
      const overview = await loadOverview(projectDir, slug);
      // Load ALL transitive deps, not just direct ones
      const transitiveDeps = getTransitiveDeps(index, reqId).filter(id => id !== reqId);
      const allReqs = await loadRequirements(projectDir, slug, transitiveDeps);
      // Also add the target requirement to the map for buildRequirementContext
      allReqs.set(reqId, req);
      const depContext = buildRequirementContext(index, allReqs, reqId)
        .filter(r => r.id !== reqId); // exclude self from deps

      // Resolve Linear identifier for branch naming
      let issueIdentifier: string | null = null;
      const meta = index.requirements[reqId];
      if (apiKey && meta?.linearIssueId && index.linear?.teamId) {
        try {
          const client = new ForgeLinearClient({ apiKey, teamId: index.linear.teamId });
          const result = await client.getIssueIdentifier(meta.linearIssueId);
          if (result.success) {
            issueIdentifier = result.data;
          }
        } catch {
          // Best-effort — fall back to reqId-only branch
        }
      }

      if (!issueIdentifier && meta?.linearIssueId) {
        console.warn(`[forge] Could not resolve Linear identifier for ${reqId} — using reqId-only branch name`);
      } else if (!meta?.linearIssueId) {
        console.warn(`[forge] No linearIssueId for ${reqId} — using reqId-only branch name`);
      }

      // Create worktree
      const wtPath = resolve(projectDir, "..", ".forge-wt", repoName(projectDir), `${slug}-${reqId}`);
      const branchSuffix = issueIdentifier ? `${issueIdentifier}-${reqId}` : reqId;
      const wtBranch = `${baseBranch}/${branchSuffix}`;
      await createWorktree(wtPath, wtBranch, baseBranch, projectDir);

      // Linear sync: start requirement
      if (apiKey && index.linear?.teamId) {
        try {
          const client = new ForgeLinearClient({ apiKey, teamId: index.linear.teamId });
          await syncRequirementStart(client, index, reqId, wtBranch);
        } catch {
          // Linear sync is best-effort
        }
      }

      let passed = false;
      let verifyErrors: PipelineResult | null = null;

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        console.log(`\n[forge] Requirement ${reqId}, iteration ${iteration}/${maxIterations}`);

        const prompt = buildRequirementPrompt({
          requirement: req,
          overview,
          depContext,
          verifyErrors,
        });

        await spawnClaude(prompt, wtPath);

        try {
          const result = await runVerifyInWorktree(wtPath);
          if (result.result === "PASSED") {
            passed = true;
            break;
          }
          verifyErrors = result;
          console.log(`[forge] Verify failed on iteration ${iteration}. Retrying...`);
        } catch (err) {
          console.warn(`[forge] Verify execution error on iteration ${iteration}:`, err);
          verifyErrors = null;
        }
      }

      if (!passed) {
        console.error(`\n[forge] Requirement ${reqId} failed after ${maxIterations} iterations.`);
        await removeWorktree(wtPath, projectDir);
        process.exit(1);
      }

      // Merge back and clean up
      console.log(`\n[forge] Requirement ${reqId} passed. Merging...`);
      await mergeWorktree(wtBranch, baseBranch, projectDir);
      await removeWorktree(wtPath, projectDir);

      // Update status to complete
      index = await updateRequirementStatus(projectDir, slug, reqId, "complete");

      console.log(`[forge] Requirement ${reqId} complete.`);
    }

    // Reload index to recompute ready set
    index = await loadIndex(projectDir, slug);
  }

  console.log(`\n[forge] All requirements for "${slug}" complete.`);
}
