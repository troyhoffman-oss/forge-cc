import { chromium, type Browser, type BrowserContext } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout } from "node:timers/promises";

let browserInstance: Browser | null = null;
let devServerProcess: ChildProcess | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({ headless: true });
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
      proc.kill();
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
