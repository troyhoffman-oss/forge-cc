import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";

const HOOK_PATH = join(__dirname, "..", "..", "hooks", "pre-commit-verify.js");

function tempDir() {
  return join(tmpdir(), `forge-hook-test-${randomUUID()}`);
}

/** Spawn the hook process, pipe hookData as JSON to stdin, return parsed stdout. */
function runHook(
  hookData: Record<string, unknown>,
  cwd: string,
): Promise<{ decision: string; reason?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [HOOK_PATH], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
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
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch {
        reject(new Error(`Failed to parse hook output: ${stdout} (stderr: ${stderr}, code: ${code})`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.stdin.write(JSON.stringify(hookData));
    child.stdin.end();
  });
}

describe("pre-commit hook", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  /** Create a temp git repo on a feature branch with a verify cache. */
  async function setupRepo(opts: {
    branch?: string;
    cacheResult?: "PASSED" | "FAILED";
    cacheTimestamp?: string;
    noCache?: boolean;
  } = {}) {
    const dir = tempDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    // Init a git repo so `git branch --show-current` works
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git checkout -b feat/test-branch", { cwd: dir, stdio: "ignore" });

    if (opts.branch === "main") {
      execSync("git checkout -b main", { cwd: dir, stdio: "ignore" });
    }

    if (!opts.noCache) {
      const forgeDir = join(dir, ".forge");
      await mkdir(forgeDir, { recursive: true });
      const cache = {
        timestamp: opts.cacheTimestamp ?? new Date().toISOString(),
        result: opts.cacheResult ?? "PASSED",
        gates: {
          types: { passed: opts.cacheResult !== "FAILED", errors: [] },
        },
      };
      await writeFile(join(forgeDir, "last-verify.json"), JSON.stringify(cache));
    }

    return dir;
  }

  it("allows non-git-commit Bash commands", async () => {
    const dir = await setupRepo();
    const result = await runHook(
      { tool_name: "Bash", tool_input: { command: "ls -la" } },
      dir,
    );
    expect(result.decision).toBe("allow");
  });

  it("allows non-Bash tool calls", async () => {
    const dir = await setupRepo();
    const result = await runHook(
      { tool_name: "Read", tool_input: { file_path: "/tmp/foo" } },
      dir,
    );
    expect(result.decision).toBe("allow");
  });

  it("blocks commits when verify cache shows FAILED", async () => {
    const dir = await setupRepo({ cacheResult: "FAILED" });
    const result = await runHook(
      { tool_name: "Bash", tool_input: { command: "git commit -m 'test'" } },
      dir,
    );
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("FAILED");
  });

  it("allows commits when verify cache shows PASSED", async () => {
    const dir = await setupRepo({ cacheResult: "PASSED" });
    const result = await runHook(
      { tool_name: "Bash", tool_input: { command: "git commit -m 'test'" } },
      dir,
    );
    expect(result.decision).toBe("allow");
  });

  it("blocks commits on main branch", async () => {
    const dir = await setupRepo({ branch: "main" });
    const result = await runHook(
      { tool_name: "Bash", tool_input: { command: "git commit -m 'test'" } },
      dir,
    );
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("main");
  });

  it("blocks commits when no verify cache exists", async () => {
    const dir = await setupRepo({ noCache: true });
    const result = await runHook(
      { tool_name: "Bash", tool_input: { command: "git commit -m 'test'" } },
      dir,
    );
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("No verification found");
  });

  it("blocks commits when verify cache is stale", async () => {
    const staleTimestamp = new Date(Date.now() - 700_000).toISOString(); // 11+ minutes ago
    const dir = await setupRepo({ cacheResult: "PASSED", cacheTimestamp: staleTimestamp });
    const result = await runHook(
      { tool_name: "Bash", tool_input: { command: "git commit -m 'test'" } },
      dir,
    );
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("stale");
  });
});
