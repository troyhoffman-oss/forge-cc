import type { Page } from "playwright";
import type {
  ViewportConfig,
  DOMSnapshot,
  VisualCaptureResult,
} from "../types.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Default viewports for multi-viewport capture: desktop, tablet, mobile */
export const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

/** Options for the visual capture function */
export interface CaptureOptions {
  pagePath: string;
  screenshotDir: string;
  viewports?: ViewportConfig[];
}

/**
 * Sanitize a page path into a safe filename component.
 * Replaces slashes with underscores and strips leading underscores.
 * Falls back to "index" for root path.
 */
function sanitizePageName(pagePath: string): string {
  const sanitized = pagePath.replace(/\//g, "_").replace(/^_/, "");
  return sanitized || "index";
}

/**
 * Extract DOM snapshot from the page via page.evaluate().
 * The entire extraction logic runs inside the browser context so it must be
 * self-contained -- no references to Node.js modules or TypeScript types.
 */
async function extractDOM(page: Page): Promise<DOMSnapshot> {
  return await page.evaluate(() => {
    interface SnapNode {
      tag: string;
      id?: string;
      className?: string;
      visible: boolean;
      rect?: { x: number; y: number; width: number; height: number };
      children: SnapNode[];
    }

    function walkElement(el: Element, isTopLevel: boolean): SnapNode {
      const style = window.getComputedStyle(el);
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0";

      const node: SnapNode = {
        tag: el.tagName.toLowerCase(),
        visible,
        children: [],
      };

      if (el.id) {
        node.id = el.id;
      }

      if (
        el.className &&
        typeof el.className === "string" &&
        el.className.trim()
      ) {
        node.className = el.className.trim();
      }

      // Only capture bounding rect for top-level elements to limit payload size
      if (isTopLevel) {
        const rect = el.getBoundingClientRect();
        node.rect = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }

      const childElements = el.children;
      for (let i = 0; i < childElements.length; i++) {
        node.children.push(walkElement(childElements[i], false));
      }

      return node;
    }

    const body = document.body;
    if (!body) {
      return { tag: "body", visible: true, children: [] };
    }

    const snapshot: SnapNode = {
      tag: "body",
      visible: true,
      children: [],
    };

    if (body.id) {
      snapshot.id = body.id;
    }
    if (
      body.className &&
      typeof body.className === "string" &&
      body.className.trim()
    ) {
      snapshot.className = body.className.trim();
    }

    const childElements = body.children;
    for (let i = 0; i < childElements.length; i++) {
      snapshot.children.push(walkElement(childElements[i], true));
    }

    return snapshot;
  });
}

/**
 * Capture multi-viewport screenshots and extract DOM structure from a Playwright page.
 *
 * For each viewport in the configuration:
 * 1. Resizes the viewport via page.setViewportSize()
 * 2. Waits for layout to settle (500ms)
 * 3. Takes a full-page screenshot saved as {safeName}_{viewportName}.png
 * 4. Extracts the serialized DOM tree via page.evaluate()
 *
 * @param page - Playwright Page instance (already navigated to the target URL)
 * @param options - Capture configuration including page path, screenshot dir, and optional viewports
 * @returns VisualCaptureResult with screenshots array, DOM snapshots per viewport, and metadata
 */
export async function captureVisual(
  page: Page,
  options: CaptureOptions,
): Promise<VisualCaptureResult> {
  const start = Date.now();
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const safeName = sanitizePageName(options.pagePath);

  mkdirSync(options.screenshotDir, { recursive: true });

  const screenshots: VisualCaptureResult["screenshots"] = [];
  const domSnapshots: Record<string, DOMSnapshot> = {};

  for (const viewport of viewports) {
    try {
      // Resize viewport
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      // Wait for layout to settle after resize
      await page.waitForTimeout(500);

      // Take full-page screenshot
      const screenshotPath = join(
        options.screenshotDir,
        `${safeName}_${viewport.name}.png`,
      );
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshots.push({
          page: options.pagePath,
          viewport: viewport.name,
          path: screenshotPath,
        });
      } catch {
        // Screenshot failed for this viewport — skip it but continue
      }

      // Extract DOM snapshot
      const domSnapshot = await extractDOM(page);
      domSnapshots[viewport.name] = domSnapshot;
    } catch {
      // Viewport resize or other operation failed — skip this viewport entirely
    }
  }

  return {
    screenshots,
    domSnapshots,
    metadata: {
      viewports,
      pagePath: options.pagePath,
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    },
  };
}
