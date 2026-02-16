import { describe, it, expect } from "vitest";
import { reviewVisual } from "../../src/gates/visual-reviewer.js";
import type { DOMSnapshot, VisualCaptureResult } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal VisualCaptureResult wrapping viewport→DOMSnapshot pairs. */
function makeCapture(
  viewportSnapshots: Record<string, DOMSnapshot>,
): VisualCaptureResult {
  return {
    screenshots: Object.keys(viewportSnapshots).map((vp) => ({
      page: "/",
      viewport: vp,
      path: `/tmp/screenshots/page_${vp}.png`,
    })),
    domSnapshots: viewportSnapshots,
    metadata: {
      viewports: Object.keys(viewportSnapshots).map((name) => ({
        name,
        width: 1280,
        height: 800,
      })),
      pagePath: "/",
      capturedAt: new Date().toISOString(),
      durationMs: 100,
    },
  };
}

/** A simple DOM tree used as a baseline across tests. */
function baseDOM(): DOMSnapshot {
  return {
    tag: "body",
    id: "root",
    className: "app",
    visible: true,
    rect: { x: 0, y: 0, width: 1280, height: 800 },
    children: [
      {
        tag: "nav",
        id: "nav",
        className: "navbar",
        visible: true,
        rect: { x: 0, y: 0, width: 1280, height: 60 },
        children: [],
      },
      {
        tag: "main",
        id: "content",
        className: "main-content",
        visible: true,
        rect: { x: 0, y: 60, width: 1280, height: 740 },
        children: [],
      },
    ],
  };
}

/** Deep-clone a DOMSnapshot so mutations in tests are isolated. */
function cloneDOM(dom: DOMSnapshot): DOMSnapshot {
  return JSON.parse(JSON.stringify(dom));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reviewVisual", () => {
  // -------------------------------------------------------------------------
  // 1. Identical DOMs produce no errors
  // -------------------------------------------------------------------------
  it("returns no errors when before and after DOMs are identical", () => {
    const before = makeCapture({ desktop: baseDOM() });
    const after = makeCapture({ desktop: baseDOM() });

    const errors = reviewVisual(before, after);

    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. Missing element produces error
  // -------------------------------------------------------------------------
  it("reports a missing element when an element is removed from the after DOM", () => {
    const beforeDOM = baseDOM();
    const afterDOM = cloneDOM(beforeDOM);
    // Remove the nav element (first child)
    afterDOM.children = afterDOM.children.filter((c) => c.id !== "nav");

    const before = makeCapture({ desktop: beforeDOM });
    const after = makeCapture({ desktop: afterDOM });

    const errors = reviewVisual(before, after);

    const missingError = errors.find((e) => e.message.includes("Missing element"));
    expect(missingError).toBeDefined();
    expect(missingError!.message).toContain("nav#nav");
    expect(missingError!.remediation).toContain("missing");
    expect(missingError!.remediation).toContain("desktop");
  });

  // -------------------------------------------------------------------------
  // 3. Added element produces error
  // -------------------------------------------------------------------------
  it("reports an added element when a new element appears in the after DOM", () => {
    const beforeDOM = baseDOM();
    const afterDOM = cloneDOM(beforeDOM);
    // Add a new footer element
    afterDOM.children.push({
      tag: "footer",
      id: "footer",
      className: "site-footer",
      visible: true,
      rect: { x: 0, y: 760, width: 1280, height: 40 },
      children: [],
    });

    const before = makeCapture({ desktop: beforeDOM });
    const after = makeCapture({ desktop: afterDOM });

    const errors = reviewVisual(before, after);

    const addedError = errors.find((e) => e.message.includes("Added element"));
    expect(addedError).toBeDefined();
    expect(addedError!.message).toContain("footer#footer");
    expect(addedError!.remediation).toContain("New element");
    expect(addedError!.remediation).toContain("desktop");
  });

  // -------------------------------------------------------------------------
  // 4. Visibility change: visible → hidden
  // -------------------------------------------------------------------------
  it("reports when an element changes from visible to hidden", () => {
    const beforeDOM = baseDOM();
    const afterDOM = cloneDOM(beforeDOM);
    // Make the nav element hidden
    afterDOM.children[0].visible = false;

    const before = makeCapture({ desktop: beforeDOM });
    const after = makeCapture({ desktop: afterDOM });

    const errors = reviewVisual(before, after);

    const hiddenError = errors.find((e) => e.message.includes("became hidden"));
    expect(hiddenError).toBeDefined();
    expect(hiddenError!.message).toContain("nav#nav");
    expect(hiddenError!.remediation).toContain("visible to hidden");
    expect(hiddenError!.remediation).toContain("CSS display/visibility/opacity");
  });

  // -------------------------------------------------------------------------
  // 5. Visibility change: hidden → visible
  // -------------------------------------------------------------------------
  it("reports when an element changes from hidden to visible", () => {
    const beforeDOM = baseDOM();
    // Start with nav hidden
    beforeDOM.children[0].visible = false;
    const afterDOM = cloneDOM(beforeDOM);
    // Make it visible in after
    afterDOM.children[0].visible = true;

    const before = makeCapture({ desktop: beforeDOM });
    const after = makeCapture({ desktop: afterDOM });

    const errors = reviewVisual(before, after);

    const visibleError = errors.find((e) => e.message.includes("became visible"));
    expect(visibleError).toBeDefined();
    expect(visibleError!.message).toContain("nav#nav");
    expect(visibleError!.remediation).toContain("hidden to visible");
  });

  // -------------------------------------------------------------------------
  // 6. Layout dimension shift > 50px triggers error
  // -------------------------------------------------------------------------
  it("reports a layout shift when an element dimension changes by more than 50px", () => {
    const beforeDOM = baseDOM();
    const afterDOM = cloneDOM(beforeDOM);
    // Shift the main content width by 100px
    afterDOM.children[1].rect!.width = 1280 + 100;

    const before = makeCapture({ desktop: beforeDOM });
    const after = makeCapture({ desktop: afterDOM });

    const errors = reviewVisual(before, after);

    const shiftError = errors.find((e) => e.message.includes("Layout shift"));
    expect(shiftError).toBeDefined();
    expect(shiftError!.message).toContain("width changed by 100px");
    expect(shiftError!.remediation).toContain(">50px");
    expect(shiftError!.remediation).toContain("desktop");
  });

  // -------------------------------------------------------------------------
  // 7. Layout shift under threshold produces no error
  // -------------------------------------------------------------------------
  it("does not report a layout shift when dimension changes are under 50px", () => {
    const beforeDOM = baseDOM();
    const afterDOM = cloneDOM(beforeDOM);
    // Shift by only 30px — under the 50px threshold
    afterDOM.children[1].rect!.width = 1280 + 30;
    afterDOM.children[1].rect!.x = 0 + 30;

    const before = makeCapture({ desktop: beforeDOM });
    const after = makeCapture({ desktop: afterDOM });

    const errors = reviewVisual(before, after);

    const shiftError = errors.find((e) => e.message.includes("Layout shift"));
    expect(shiftError).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 8. Errors are tagged with viewport name
  // -------------------------------------------------------------------------
  it("tags all error messages with the viewport name", () => {
    const beforeDOM = baseDOM();
    const afterDOM = cloneDOM(beforeDOM);
    // Remove an element to generate an error
    afterDOM.children = afterDOM.children.filter((c) => c.id !== "nav");

    const before = makeCapture({ mobile: beforeDOM });
    const after = makeCapture({ mobile: afterDOM });

    const errors = reviewVisual(before, after);

    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error.message).toContain("[mobile]");
    }
  });

  // -------------------------------------------------------------------------
  // 9. Significant element count change produces error
  // -------------------------------------------------------------------------
  it("reports a significant element count change exceeding 20%", () => {
    // Before: root with 4 children = 5 total nodes
    const beforeDOM: DOMSnapshot = {
      tag: "body",
      id: "root",
      visible: true,
      children: [
        { tag: "div", id: "a", visible: true, children: [] },
        { tag: "div", id: "b", visible: true, children: [] },
        { tag: "div", id: "c", visible: true, children: [] },
        { tag: "div", id: "d", visible: true, children: [] },
      ],
    };

    // After: root with 9 children = 10 total nodes (100% increase, > 20%)
    const afterDOM: DOMSnapshot = {
      tag: "body",
      id: "root",
      visible: true,
      children: [
        { tag: "div", id: "a", visible: true, children: [] },
        { tag: "div", id: "b", visible: true, children: [] },
        { tag: "div", id: "c", visible: true, children: [] },
        { tag: "div", id: "d", visible: true, children: [] },
        { tag: "div", id: "e", visible: true, children: [] },
        { tag: "div", id: "f", visible: true, children: [] },
        { tag: "div", id: "g", visible: true, children: [] },
        { tag: "div", id: "h", visible: true, children: [] },
        { tag: "div", id: "i", visible: true, children: [] },
      ],
    };

    const before = makeCapture({ desktop: beforeDOM });
    const after = makeCapture({ desktop: afterDOM });

    const errors = reviewVisual(before, after);

    const countError = errors.find((e) =>
      e.message.includes("Significant element count"),
    );
    expect(countError).toBeDefined();
    expect(countError!.message).toContain("increase");
    expect(countError!.message).toContain("5 -> 10");
    expect(countError!.remediation).toContain("element count increase");
  });

  // -------------------------------------------------------------------------
  // 10. Multiple viewports are compared independently
  // -------------------------------------------------------------------------
  it("compares multiple viewports independently and reports separate errors", () => {
    const beforeDesktop = baseDOM();
    const afterDesktop = cloneDOM(beforeDesktop);
    // Remove nav on desktop
    afterDesktop.children = afterDesktop.children.filter((c) => c.id !== "nav");

    const beforeMobile = baseDOM();
    const afterMobile = cloneDOM(beforeMobile);
    // Make content hidden on mobile
    afterMobile.children[1].visible = false;

    const before = makeCapture({
      desktop: beforeDesktop,
      mobile: beforeMobile,
    });
    const after = makeCapture({
      desktop: afterDesktop,
      mobile: afterMobile,
    });

    const errors = reviewVisual(before, after);

    // Should have errors from both viewports
    const desktopErrors = errors.filter((e) => e.message.includes("[desktop]"));
    const mobileErrors = errors.filter((e) => e.message.includes("[mobile]"));

    expect(desktopErrors.length).toBeGreaterThan(0);
    expect(mobileErrors.length).toBeGreaterThan(0);

    // Desktop should have the missing nav error
    const desktopMissing = desktopErrors.find((e) =>
      e.message.includes("Missing element"),
    );
    expect(desktopMissing).toBeDefined();
    expect(desktopMissing!.message).toContain("nav#nav");

    // Mobile should have the visibility change error
    const mobileHidden = mobileErrors.find((e) =>
      e.message.includes("became hidden"),
    );
    expect(mobileHidden).toBeDefined();
    expect(mobileHidden!.message).toContain("main#content");
  });
});
