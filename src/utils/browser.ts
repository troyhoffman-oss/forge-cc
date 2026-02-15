import { chromium, type Browser, type BrowserContext } from "playwright";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { setTimeout } from "node:timers/promises";

let browserInstance: Browser | null = null;
let devServerProcess: ChildProcess | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    try {
      browserInstance = await chromium.launch({ headless: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Executable doesn't exist") || message.includes("browserType.launch")) {
        throw new Error(
          `Playwright browsers are not installed. Run "npx playwright install chromium" to fix this. Original error: ${message}`,
        );
      }
      throw err;
    }
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function startDevServer(
  projectDir: string,
  command?: string,
  port?: number,
): Promise<{ port: number; process: ChildProcess }> {
  const resolvedCommand = command ?? "npm run dev";
  const resolvedPort = port ?? 3000;

  // Kill any existing dev server before starting a new one
  await stopDevServer();

  devServerProcess = spawn(resolvedCommand, {
    cwd: projectDir,
    shell: true,
    stdio: "pipe",
  });

  // Wait for the server to become reachable
  const ready = await waitForServer(resolvedPort);
  if (!ready) {
    await stopDevServer();
    throw new Error(
      `Dev server failed to start on port ${resolvedPort} within timeout`,
    );
  }

  return { port: resolvedPort, process: devServerProcess };
}

export async function stopDevServer(): Promise<void> {
  if (devServerProcess) {
    const proc = devServerProcess;
    devServerProcess = null;

    try {
      if (process.platform === "win32" && proc.pid) {
        // On Windows, proc.kill() doesn't kill the child process tree.
        // Use taskkill with /T (tree) /F (force) to kill the process and its children.
        try {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "pipe" });
        } catch {
          // taskkill may fail if the process already exited — fall back to proc.kill()
          try { proc.kill(); } catch { /* already exited */ }
        }
      } else {
        proc.kill();
      }
    } catch {
      // Process may have already exited — ignore
    }

    // Brief wait for cleanup
    await setTimeout(500);
  }
}

export async function waitForServer(
  port: number,
  timeoutMs?: number,
): Promise<boolean> {
  const deadline = Date.now() + (timeoutMs ?? 30_000);

  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}`);
      return true;
    } catch {
      // Server not ready yet — wait and retry
      await setTimeout(1000);
    }
  }

  return false;
}
