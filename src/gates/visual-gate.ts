import type { GateError, VisualResult } from "../types.js";
import {
  getBrowser,
  startDevServer,
  stopDevServer,
  waitForServer,
} from "../utils/browser.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export async function verifyVisual(
  projectDir: string,
  pages: string[],
  options?: {
    devServerCommand?: string;
    devServerPort?: number;
    screenshotDir?: string;
  },
): Promise<VisualResult> {
  const start = Date.now();
  const resolvedPages = pages.length > 0 ? pages : ["/"];
  const port = options?.devServerPort ?? 3000;
  const screenshotDir =
    options?.screenshotDir ?? join(projectDir, ".forge", "screenshots");
  const consoleErrors: string[] = [];
  const warnings: string[] = [];
  const screenshots: Array<{ page: string; path: string }> = [];

  mkdirSync(screenshotDir, { recursive: true });

  try {
    // Start dev server
    try {
      await startDevServer(projectDir, options?.devServerCommand, port);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown dev server error";
      return {
        gate: "visual",
        passed: false,
        errors: [{ message: `Dev server failed to start: ${message}` }],
        warnings,
        duration_ms: Date.now() - start,
        screenshots,
        consoleErrors,
      };
    }

    // Ensure server is reachable
    const ready = await waitForServer(port);
    if (!ready) {
      return {
        gate: "visual",
        passed: false,
        errors: [{ message: `Dev server not reachable on port ${port}` }],
        warnings,
        duration_ms: Date.now() - start,
        screenshots,
        consoleErrors,
      };
    }

    // Launch browser and create context
    const browser = await getBrowser();
    const context = await browser.newContext();

    try {
      for (const pagePath of resolvedPages) {
        const page = await context.newPage();

        // Collect console errors
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            consoleErrors.push(msg.text());
          }
        });

        page.on("pageerror", (err) => {
          consoleErrors.push(err.message);
        });

        // Navigate to the page
        try {
          await page.goto(`http://localhost:${port}${pagePath}`, {
            waitUntil: "networkidle",
            timeout: 30_000,
          });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Navigation failed";
          consoleErrors.push(`Navigation error for ${pagePath}: ${message}`);
          await page.close();
          continue;
        }

        // Take screenshot
        try {
          const safeName = pagePath.replace(/\//g, "_").replace(/^_/, "") || "index";
          const screenshotPath = join(screenshotDir, `${safeName}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          screenshots.push({ page: pagePath, path: screenshotPath });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Screenshot failed";
          warnings.push(`Screenshot failed for ${pagePath}: ${message}`);
        }

        await page.close();
      }
    } finally {
      await context.close();
    }

    // Convert console errors to GateError objects
    const errors: GateError[] = consoleErrors.map((msg) => ({
      message: msg,
    }));

    return {
      gate: "visual",
      passed: consoleErrors.length === 0,
      errors,
      warnings,
      duration_ms: Date.now() - start,
      screenshots,
      consoleErrors,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error in verifyVisual";
    return {
      gate: "visual",
      passed: false,
      errors: [{ message }],
      warnings,
      duration_ms: Date.now() - start,
      screenshots,
      consoleErrors,
    };
  } finally {
    await stopDevServer();
  }
}
