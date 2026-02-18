import type { GateError, VisualCaptureResult, VisualResult } from "../types.js";
import {
  getBrowser,
  startDevServer,
  stopDevServer,
  waitForServer,
} from "../utils/browser.js";
import { captureVisual } from "./visual-capture.js";
import { reviewVisual } from "./visual-reviewer.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Before snapshot disk persistence
// ---------------------------------------------------------------------------

/** Sanitize a page path to a safe filename key (e.g. "/" -> "index", "/dashboard" -> "dashboard") */
function snapshotKey(pagePath: string): string {
  const sanitized = pagePath.replace(/\//g, "_").replace(/^_/, "");
  return sanitized || "index";
}

/** Save a before snapshot to disk so it survives across CLI invocations. */
function saveBeforeSnapshot(screenshotDir: string, pagePath: string, result: VisualCaptureResult): void {
  const dir = join(screenshotDir, "before");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${snapshotKey(pagePath)}.snapshot.json`);
  writeFileSync(filePath, JSON.stringify(result, null, 2));
}

/** Load a before snapshot from disk. Returns null if none exists. */
function loadBeforeSnapshot(screenshotDir: string, pagePath: string): VisualCaptureResult | null {
  const filePath = join(screenshotDir, "before", `${snapshotKey(pagePath)}.snapshot.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as VisualCaptureResult;
  } catch {
    return null;
  }
}

/**
 * Capture and store "before" snapshots for the given pages.
 * Snapshots are persisted to disk (.forge/screenshots/before/*.snapshot.json)
 * so they survive across separate CLI invocations.
 */
export async function captureBeforeSnapshots(
  projectDir: string,
  pages: string[],
  options?: {
    devServerCommand?: string;
    devServerPort?: number;
    screenshotDir?: string;
  },
): Promise<void> {
  const resolvedPages = pages.length > 0 ? pages : ["/"];
  const port = options?.devServerPort ?? 3000;
  const screenshotDir =
    options?.screenshotDir ?? join(projectDir, ".forge", "screenshots");
  const beforeDir = join(screenshotDir, "before");

  mkdirSync(beforeDir, { recursive: true });

  try {
    await startDevServer(projectDir, options?.devServerCommand, port);

    const ready = await waitForServer(port);
    if (!ready) {
      return; // Cannot capture baseline — verifyVisual will still work without it
    }

    const browser = await getBrowser();
    const context = await browser.newContext();

    try {
      for (const pagePath of resolvedPages) {
        const page = await context.newPage();

        try {
          await page.goto(`http://localhost:${port}${pagePath}`, {
            waitUntil: "networkidle",
            timeout: 30_000,
          });

          const result = await captureVisual(page, {
            pagePath,
            screenshotDir: beforeDir,
          });

          saveBeforeSnapshot(screenshotDir, pagePath, result);
        } catch {
          // Failed to capture baseline for this page — skip it
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    await stopDevServer();
  }
}

/** Clear all stored "before" snapshots from disk (e.g. between milestones). */
export function clearBeforeSnapshots(projectDir: string): void {
  const dir = join(projectDir, ".forge", "screenshots", "before");
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return; // Directory doesn't exist — nothing to clear
  }
  for (const file of files) {
    if (file.endsWith(".snapshot.json")) {
      try { unlinkSync(join(dir, file)); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Main visual gate
// ---------------------------------------------------------------------------

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
  const afterDir = join(screenshotDir, "after");
  const consoleErrors: string[] = [];
  const warnings: string[] = [];
  const screenshots: Array<{ page: string; path: string }> = [];

  mkdirSync(afterDir, { recursive: true });

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
    const reviewerErrors: GateError[] = [];

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

        // Capture "after" snapshot using the M1 capture module
        try {
          const afterResult = await captureVisual(page, {
            pagePath,
            screenshotDir: afterDir,
          });

          // Map multi-viewport screenshots to the flat { page, path } format
          for (const shot of afterResult.screenshots) {
            screenshots.push({ page: shot.page, path: shot.path });
          }

          // Compare with "before" snapshot if one exists (loaded from disk)
          const beforeResult = loadBeforeSnapshot(screenshotDir, pagePath);
          if (beforeResult) {
            const findings = reviewVisual(beforeResult, afterResult);
            reviewerErrors.push(...findings);
          } else {
            warnings.push(
              `No baseline snapshot for ${pagePath} — before/after comparison skipped. Call captureBeforeSnapshots() before verifyVisual() to enable.`,
            );
          }
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Visual capture failed";
          warnings.push(`Visual capture failed for ${pagePath}: ${message}`);
        }

        await page.close();
      }
    } finally {
      await context.close();
    }

    // Combine console errors and reviewer errors into a single GateError list
    const errors: GateError[] = [
      ...consoleErrors.map((msg) => ({ message: msg })),
      ...reviewerErrors,
    ];

    return {
      gate: "visual",
      passed: errors.length === 0,
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
