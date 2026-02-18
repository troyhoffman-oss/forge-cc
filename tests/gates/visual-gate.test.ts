import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock ALL external dependencies before importing the module under test
// ---------------------------------------------------------------------------

// In-memory file store for before-snapshot persistence tests
const fileStore = new Map<string, string>();

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn((path: string, data: string) => { fileStore.set(path, data); }),
  readFileSync: vi.fn((path: string) => {
    const data = fileStore.get(path);
    if (data === undefined) throw new Error(`ENOENT: ${path}`);
    return data;
  }),
  existsSync: vi.fn((path: string) => fileStore.has(path)),
  readdirSync: vi.fn((dir: string) => {
    const files: string[] = [];
    for (const key of fileStore.keys()) {
      if (key.startsWith(dir)) {
        const relative = key.slice(dir.length).replace(/^[\\/]/, "");
        if (!relative.includes("/") && !relative.includes("\\")) {
          files.push(relative);
        }
      }
    }
    return files;
  }),
  unlinkSync: vi.fn((path: string) => { fileStore.delete(path); }),
}));

vi.mock("../../src/utils/browser.js", () => ({
  getBrowser: vi.fn(),
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
  waitForServer: vi.fn(),
}));

vi.mock("../../src/gates/visual-capture.js", () => ({
  captureVisual: vi.fn(),
  DEFAULT_VIEWPORTS: [
    { name: "desktop", width: 1280, height: 800 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ],
}));

vi.mock("../../src/gates/visual-reviewer.js", () => ({
  reviewVisual: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  verifyVisual,
  captureBeforeSnapshots,
  clearBeforeSnapshots,
} from "../../src/gates/visual-gate.js";
import {
  getBrowser,
  startDevServer,
  stopDevServer,
  waitForServer,
} from "../../src/utils/browser.js";
import { captureVisual } from "../../src/gates/visual-capture.js";
import { reviewVisual } from "../../src/gates/visual-reviewer.js";
import type { VisualCaptureResult } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Playwright page with console/pageerror listener support. */
function createMockPage() {
  const listeners: Record<string, Function[]> = {};
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    goto: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    /** Trigger registered "console" listeners with an error-type message. */
    _triggerConsole: (text: string) => {
      for (const handler of listeners["console"] || []) {
        handler({ type: () => "error", text: () => text });
      }
    },
    /** Trigger registered "pageerror" listeners. */
    _triggerPageError: (message: string) => {
      for (const handler of listeners["pageerror"] || []) {
        handler({ message });
      }
    },
  };
}

/** Build a minimal VisualCaptureResult for use in mocks. */
function makeCaptureResult(
  pagePath: string,
  dir: string,
): VisualCaptureResult {
  return {
    screenshots: [
      { page: pagePath, viewport: "desktop", path: `${dir}/${pagePath}_desktop.png` },
      { page: pagePath, viewport: "tablet", path: `${dir}/${pagePath}_tablet.png` },
      { page: pagePath, viewport: "mobile", path: `${dir}/${pagePath}_mobile.png` },
    ],
    domSnapshots: {
      desktop: { tag: "body", visible: true, children: [] },
      tablet: { tag: "body", visible: true, children: [] },
      mobile: { tag: "body", visible: true, children: [] },
    },
    metadata: {
      viewports: [
        { name: "desktop", width: 1280, height: 800 },
        { name: "tablet", width: 768, height: 1024 },
        { name: "mobile", width: 390, height: 844 },
      ],
      pagePath,
      capturedAt: new Date().toISOString(),
      durationMs: 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared mock-browser scaffold wired up in beforeEach
// ---------------------------------------------------------------------------

let mockPage: ReturnType<typeof createMockPage>;

function setupBrowserMocks() {
  mockPage = createMockPage();

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
  };

  vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);
  vi.mocked(startDevServer).mockResolvedValue(undefined as any);
  vi.mocked(stopDevServer).mockResolvedValue(undefined);
  vi.mocked(waitForServer).mockResolvedValue(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("visual-gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileStore.clear();
    clearBeforeSnapshots("/proj");
    setupBrowserMocks();
  });

  // -------------------------------------------------------------------------
  // 1. verifyVisual calls captureVisual for the page
  // -------------------------------------------------------------------------
  it("calls captureVisual with the page and correct options", async () => {
    const afterResult = makeCaptureResult("/", "/proj/.forge/screenshots/after");
    vi.mocked(captureVisual).mockResolvedValue(afterResult);
    vi.mocked(reviewVisual).mockReturnValue([]);

    await verifyVisual("/proj", ["/"]);

    expect(captureVisual).toHaveBeenCalledTimes(1);
    expect(captureVisual).toHaveBeenCalledWith(
      mockPage,
      expect.objectContaining({
        pagePath: "/",
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 2. Maps multi-viewport screenshots to flat format
  // -------------------------------------------------------------------------
  it("maps multi-viewport screenshots to flat { page, path } format", async () => {
    const afterResult = makeCaptureResult("/", "/proj/.forge/screenshots/after");
    vi.mocked(captureVisual).mockResolvedValue(afterResult);
    vi.mocked(reviewVisual).mockReturnValue([]);

    const result = await verifyVisual("/proj", ["/"]);

    expect(result.screenshots).toHaveLength(3);

    // Each entry should have page and path but NOT viewport (flat format)
    for (const shot of result.screenshots) {
      expect(shot).toHaveProperty("page");
      expect(shot).toHaveProperty("path");
    }

    // Verify the actual values match what captureVisual returned
    expect(result.screenshots[0]).toEqual({
      page: "/",
      path: "/proj/.forge/screenshots/after//_desktop.png",
    });
  });

  // -------------------------------------------------------------------------
  // 3. Console errors still detected and reported
  // -------------------------------------------------------------------------
  it("detects console errors and marks gate as failed", async () => {
    const afterResult = makeCaptureResult("/", "/proj/.forge/screenshots/after");

    // Make captureVisual trigger console errors before resolving
    vi.mocked(captureVisual).mockImplementation(async () => {
      // Trigger console errors through the page listeners
      mockPage._triggerConsole("Uncaught TypeError: x is not a function");
      mockPage._triggerPageError("Runtime crash: null reference");
      return afterResult;
    });
    vi.mocked(reviewVisual).mockReturnValue([]);

    const result = await verifyVisual("/proj", ["/"]);

    expect(result.passed).toBe(false);
    expect(result.consoleErrors).toHaveLength(2);
    expect(result.consoleErrors).toContain(
      "Uncaught TypeError: x is not a function",
    );
    expect(result.consoleErrors).toContain("Runtime crash: null reference");

    // Console errors should also appear in the errors array
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.message.includes("TypeError"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Before/after comparison produces reviewer findings
  // -------------------------------------------------------------------------
  it("compares before and after snapshots via reviewVisual", async () => {
    const beforeResult = makeCaptureResult("/", "/proj/.forge/screenshots/before");
    const afterResult = makeCaptureResult("/", "/proj/.forge/screenshots/after");

    // Setup captureVisual to return different results for before and after calls
    vi.mocked(captureVisual).mockResolvedValue(beforeResult);

    // Capture before snapshots
    await captureBeforeSnapshots("/proj", ["/"]);

    // Reset and set up for the verifyVisual call
    vi.mocked(captureVisual).mockResolvedValue(afterResult);
    setupBrowserMocks();

    const reviewerFindings = [
      { message: "[desktop] Missing element: body > div#sidebar" },
      {
        message: "[mobile] Layout shift on body > nav: x shifted by 100px",
        remediation: "Review layout changes.",
      },
    ];
    vi.mocked(reviewVisual).mockReturnValue(reviewerFindings);

    const result = await verifyVisual("/proj", ["/"]);

    expect(reviewVisual).toHaveBeenCalledTimes(1);
    // Before result was serialized to disk and deserialized, so deep-equal not reference-equal
    expect(reviewVisual).toHaveBeenCalledWith(
      expect.objectContaining({ domSnapshots: beforeResult.domSnapshots }),
      afterResult,
    );
    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "[desktop] Missing element: body > div#sidebar",
        }),
        expect.objectContaining({
          message: "[mobile] Layout shift on body > nav: x shifted by 100px",
        }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // 5. Gate passes when no errors
  // -------------------------------------------------------------------------
  it("passes when no console errors and no reviewer findings", async () => {
    const afterResult = makeCaptureResult("/", "/proj/.forge/screenshots/after");
    vi.mocked(captureVisual).mockResolvedValue(afterResult);
    vi.mocked(reviewVisual).mockReturnValue([]);

    // No beforeSnapshot stored, so reviewVisual won't be called
    const result = await verifyVisual("/proj", ["/"]);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.consoleErrors).toHaveLength(0);
    expect(result.gate).toBe("visual");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 6. Gate fails on dev server start failure
  // -------------------------------------------------------------------------
  it("fails when dev server cannot start", async () => {
    vi.mocked(startDevServer).mockRejectedValue(
      new Error("EADDRINUSE: port 3000 already in use"),
    );

    const result = await verifyVisual("/proj", ["/"]);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Dev server failed to start");
    expect(result.errors[0].message).toContain("EADDRINUSE");
  });

  // -------------------------------------------------------------------------
  // 7. Gate result includes both console errors and reviewer findings
  // -------------------------------------------------------------------------
  it("combines console errors and reviewer findings in errors array", async () => {
    // Set up before snapshots so reviewer will be invoked
    const beforeResult = makeCaptureResult("/", "/proj/.forge/screenshots/before");
    vi.mocked(captureVisual).mockResolvedValue(beforeResult);
    await captureBeforeSnapshots("/proj", ["/"]);

    // Reset for verifyVisual
    const afterResult = makeCaptureResult("/", "/proj/.forge/screenshots/after");
    setupBrowserMocks();

    // captureVisual triggers a console error, then returns a result
    vi.mocked(captureVisual).mockImplementation(async () => {
      mockPage._triggerConsole("Uncaught ReferenceError: foo is undefined");
      return afterResult;
    });

    const reviewerFindings = [
      { message: "[desktop] Element became hidden: body > div#banner" },
    ];
    vi.mocked(reviewVisual).mockReturnValue(reviewerFindings);

    const result = await verifyVisual("/proj", ["/"]);

    expect(result.passed).toBe(false);

    // Console errors appear in both consoleErrors and errors
    expect(result.consoleErrors).toContain(
      "Uncaught ReferenceError: foo is undefined",
    );

    // errors array should contain BOTH console-derived errors and reviewer findings
    const consoleErrorInErrors = result.errors.find((e) =>
      e.message.includes("ReferenceError"),
    );
    const reviewerErrorInErrors = result.errors.find((e) =>
      e.message.includes("Element became hidden"),
    );

    expect(consoleErrorInErrors).toBeDefined();
    expect(reviewerErrorInErrors).toBeDefined();

    // Total errors = 1 console error + 1 reviewer finding
    expect(result.errors).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 8. clearBeforeSnapshots clears stored snapshots
  // -------------------------------------------------------------------------
  it("clearBeforeSnapshots prevents reviewVisual from being called", async () => {
    // Capture before snapshots
    const beforeResult = makeCaptureResult("/", "/proj/.forge/screenshots/before");
    vi.mocked(captureVisual).mockResolvedValue(beforeResult);
    await captureBeforeSnapshots("/proj", ["/"]);

    // Clear them
    clearBeforeSnapshots("/proj");

    // Now verifyVisual should NOT call reviewVisual since no before snapshot exists
    const afterResult = makeCaptureResult("/", "/proj/.forge/screenshots/after");
    setupBrowserMocks();
    vi.mocked(captureVisual).mockResolvedValue(afterResult);

    const result = await verifyVisual("/proj", ["/"]);

    expect(reviewVisual).not.toHaveBeenCalled();
    expect(result.passed).toBe(true);
  });
});
