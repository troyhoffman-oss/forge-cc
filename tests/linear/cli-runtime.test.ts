import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const DIST_CLI = join(__dirname, "..", "..", "dist", "cli.js");
const DIST_LOOP = join(__dirname, "..", "..", "dist", "runner", "loop.js");
const DIST_SYNC = join(__dirname, "..", "..", "dist", "linear", "sync.js");
const DIST_CLIENT = join(__dirname, "..", "..", "dist", "linear", "client.js");

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", [DIST_CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on("error", () => {
      resolve({ code: 1, stdout, stderr });
    });
  });
}

describe("dist Linear runtime surface", () => {
  it("exposes `forge linear ship`, `sync-planned`, and `sync-merged` in help output", async () => {
    const result = await runCli(["linear", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ship");
    expect(result.stdout).toContain("sync-planned");
    expect(result.stdout).toContain("sync-merged");
  });

  it("recognizes `forge linear ship --help` as a valid command", async () => {
    const result = await runCli(["linear", "ship", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("unknown command");
    expect(result.stdout).toContain("Push branch");
  });

  it("recognizes `forge linear sync-planned --help` as a valid command", async () => {
    const result = await runCli(["linear", "sync-planned", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("unknown command");
    expect(result.stdout).toContain("Transition project to Planned");
  });

  it("recognizes `forge linear sync-merged --help` as a valid command", async () => {
    const result = await runCli(["linear", "sync-merged", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("unknown command");
    expect(result.stdout).toContain("Transition project to Completed");
  });

  it("uses review/planned/completed sync functions and keeps review out of graph loop runtime", async () => {
    const loop = await readFile(DIST_LOOP, "utf-8");
    const sync = await readFile(DIST_SYNC, "utf-8");

    expect(loop).not.toContain("syncGraphProjectReview");
    expect(loop).not.toContain("syncGraphProjectDone");

    expect(sync).toContain("syncGraphProjectReview");
    expect(sync).toContain("syncGraphProjectPlanned");
    expect(sync).toContain("syncGraphProjectCompleted");
    expect(sync).not.toContain("syncGraphProjectDone");
  });

  it("does not use unsupported IssueUpdateInput.branchName mutation in dist runtime", async () => {
    const client = await readFile(DIST_CLIENT, "utf-8");

    expect(client).toContain("issueVcsBranchSearch");
    expect(client).toContain("attachmentLinkGitHubPR");
    expect(client).not.toContain("updateIssue(issueId, { branchName");
  });
});
