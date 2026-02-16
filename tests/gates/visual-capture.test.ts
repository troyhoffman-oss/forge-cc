import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Import after mocks are set up
import { captureVisual, DEFAULT_VIEWPORTS } from "../../src/gates/visual-capture.js";
import type { DOMSnapshot, VisualCaptureResult } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mock Playwright Page
// ---------------------------------------------------------------------------

function createMockDOMSnapshot(tag = "body"): DOMSnapshot {
  return {
    tag,
    id: "root",
    className: "app",
    visible: true,
    rect: { x: 0, y: 0, width: 1280, height: 800 },
    children: [
      {
        tag: "div",
        id: "main",
        className: "container",
        visible: true,
        rect: { x: 0, y: 0, width: 1280, height: 600 },
        children: [],
      },
    ],
  };
}

function createMockPage() {
  return {
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    evaluate: vi.fn().mockResolvedValue(createMockDOMSnapshot()),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("http://localhost:3000/"),
  };
}

describe("captureVisual", () => {
  let mockPage: ReturnType<typeof createMockPage>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage = createMockPage();
  });

  // -----------------------------------------------------------------------
  // Test 1: 3 viewports produce 3 screenshots
  // -----------------------------------------------------------------------
  it("produces 3 screenshots for 3 default viewports", async () => {
    const result = await captureVisual(mockPage as any, {
      pagePath: "/",
      screenshotDir: "/tmp/screenshots",
    });

    expect(result.screenshots).toHaveLength(3);

    const viewportNames = result.screenshots.map((s) => s.viewport);
    expect(viewportNames).toContain("desktop");
    expect(viewportNames).toContain("tablet");
    expect(viewportNames).toContain("mobile");

    // setViewportSize called once per viewport
    expect(mockPage.setViewportSize).toHaveBeenCalledTimes(3);
    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 800 });
    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 768, height: 1024 });
    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 390, height: 844 });

    // screenshot called once per viewport
    expect(mockPage.screenshot).toHaveBeenCalledTimes(3);
  });

  // -----------------------------------------------------------------------
  // Test 2: DOM extraction returns element tree for each viewport
  // -----------------------------------------------------------------------
  it("returns DOM snapshots for each viewport", async () => {
    const result = await captureVisual(mockPage as any, {
      pagePath: "/",
      screenshotDir: "/tmp/screenshots",
    });

    // domSnapshots should have an entry per viewport
    expect(Object.keys(result.domSnapshots)).toHaveLength(3);
    expect(result.domSnapshots).toHaveProperty("desktop");
    expect(result.domSnapshots).toHaveProperty("tablet");
    expect(result.domSnapshots).toHaveProperty("mobile");

    // Validate structure of DOM snapshot
    const desktopSnapshot = result.domSnapshots["desktop"];
    expect(desktopSnapshot.tag).toBe("body");
    expect(desktopSnapshot.visible).toBe(true);
    expect(desktopSnapshot.children).toBeInstanceOf(Array);
    expect(desktopSnapshot.children.length).toBeGreaterThan(0);
    expect(desktopSnapshot.children[0].tag).toBe("div");

    // page.evaluate called once per viewport for DOM extraction
    expect(mockPage.evaluate).toHaveBeenCalledTimes(3);
  });

  // -----------------------------------------------------------------------
  // Test 3: Graceful handling when viewport resize fails
  // -----------------------------------------------------------------------
  it("handles viewport resize failure gracefully", async () => {
    // Fail on the second viewport (tablet) but succeed for desktop and mobile
    let callCount = 0;
    mockPage.setViewportSize.mockImplementation(async ({ width }: { width: number; height: number }) => {
      callCount++;
      if (width === 768) {
        throw new Error("Failed to resize viewport to tablet dimensions");
      }
    });

    const result = await captureVisual(mockPage as any, {
      pagePath: "/",
      screenshotDir: "/tmp/screenshots",
    });

    // Should still return results — at minimum the successful viewports
    expect(result.screenshots.length).toBeGreaterThanOrEqual(2);

    // The successful viewports should be present
    const viewportNames = result.screenshots.map((s) => s.viewport);
    expect(viewportNames).toContain("desktop");
    expect(viewportNames).toContain("mobile");
  });

  // -----------------------------------------------------------------------
  // Test 4: Screenshot naming convention
  // -----------------------------------------------------------------------
  it("follows expected screenshot naming convention", async () => {
    const result = await captureVisual(mockPage as any, {
      pagePath: "/about",
      screenshotDir: "/tmp/screenshots",
    });

    expect(result.screenshots).toHaveLength(3);

    // Paths should follow {screenshotDir}/{safeName}_{viewportName}.png
    const desktopShot = result.screenshots.find((s) => s.viewport === "desktop");
    const tabletShot = result.screenshots.find((s) => s.viewport === "tablet");
    const mobileShot = result.screenshots.find((s) => s.viewport === "mobile");

    expect(desktopShot).toBeDefined();
    expect(tabletShot).toBeDefined();
    expect(mobileShot).toBeDefined();

    // Check that paths contain the viewport name and pagePath-derived name
    expect(desktopShot!.path).toContain("about");
    expect(desktopShot!.path).toContain("desktop");
    expect(desktopShot!.path).toMatch(/\.png$/);

    expect(tabletShot!.path).toContain("about");
    expect(tabletShot!.path).toContain("tablet");
    expect(tabletShot!.path).toMatch(/\.png$/);

    expect(mobileShot!.path).toContain("about");
    expect(mobileShot!.path).toContain("mobile");
    expect(mobileShot!.path).toMatch(/\.png$/);
  });

  // -----------------------------------------------------------------------
  // Test 5: Default viewports are used when not specified
  // -----------------------------------------------------------------------
  it("uses DEFAULT_VIEWPORTS when viewports not specified", async () => {
    expect(DEFAULT_VIEWPORTS).toHaveLength(3);
    expect(DEFAULT_VIEWPORTS).toEqual([
      { name: "desktop", width: 1280, height: 800 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 390, height: 844 },
    ]);

    const result = await captureVisual(mockPage as any, {
      pagePath: "/",
      screenshotDir: "/tmp/screenshots",
      // No viewports specified — defaults should be used
    });

    expect(result.screenshots).toHaveLength(3);
    expect(mockPage.setViewportSize).toHaveBeenCalledTimes(3);

    // Confirm the metadata records the viewports used
    expect(result.metadata.viewports).toEqual(DEFAULT_VIEWPORTS);
  });

  // -----------------------------------------------------------------------
  // Test 6: Custom viewports override defaults
  // -----------------------------------------------------------------------
  it("uses custom viewports when provided", async () => {
    const customViewports = [
      { name: "ultrawide", width: 2560, height: 1080 },
      { name: "small", width: 320, height: 568 },
    ];

    const result = await captureVisual(mockPage as any, {
      pagePath: "/",
      screenshotDir: "/tmp/screenshots",
      viewports: customViewports,
    });

    // Only 2 screenshots for 2 custom viewports
    expect(result.screenshots).toHaveLength(2);
    expect(mockPage.setViewportSize).toHaveBeenCalledTimes(2);

    const viewportNames = result.screenshots.map((s) => s.viewport);
    expect(viewportNames).toContain("ultrawide");
    expect(viewportNames).toContain("small");
    expect(viewportNames).not.toContain("desktop");
    expect(viewportNames).not.toContain("tablet");
    expect(viewportNames).not.toContain("mobile");

    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 2560, height: 1080 });
    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 320, height: 568 });

    // Metadata should reflect custom viewports
    expect(result.metadata.viewports).toEqual(customViewports);
  });

  // -----------------------------------------------------------------------
  // Test 7: Metadata is populated correctly
  // -----------------------------------------------------------------------
  it("populates metadata with pagePath and capturedAt timestamp", async () => {
    const result = await captureVisual(mockPage as any, {
      pagePath: "/dashboard",
      screenshotDir: "/tmp/screenshots",
    });

    expect(result.metadata.pagePath).toBe("/dashboard");
    expect(result.metadata.capturedAt).toBeDefined();
    // capturedAt should be a valid ISO timestamp
    expect(new Date(result.metadata.capturedAt).toISOString()).toBe(result.metadata.capturedAt);
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // Test 8: Screenshot failure on one viewport does not crash the whole run
  // -----------------------------------------------------------------------
  it("handles screenshot failure gracefully", async () => {
    let screenshotCallCount = 0;
    mockPage.screenshot.mockImplementation(async () => {
      screenshotCallCount++;
      if (screenshotCallCount === 2) {
        throw new Error("Screenshot capture failed");
      }
      return Buffer.from("fake-png");
    });

    const result = await captureVisual(mockPage as any, {
      pagePath: "/",
      screenshotDir: "/tmp/screenshots",
    });

    // Should still get results for the other viewports
    expect(result.screenshots.length).toBeGreaterThanOrEqual(2);
  });

  // -----------------------------------------------------------------------
  // Test 9: Root page path "/" produces valid screenshot names
  // -----------------------------------------------------------------------
  it("handles root page path correctly for naming", async () => {
    const result = await captureVisual(mockPage as any, {
      pagePath: "/",
      screenshotDir: "/tmp/screenshots",
    });

    // All screenshot paths should be valid (non-empty, end with .png)
    for (const shot of result.screenshots) {
      expect(shot.path).toBeTruthy();
      expect(shot.path).toMatch(/\.png$/);
      expect(shot.viewport).toBeTruthy();
    }
  });
});
