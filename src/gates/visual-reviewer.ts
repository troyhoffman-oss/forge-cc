import type {
  GateError,
  DOMSnapshot,
  VisualCaptureResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable DOM path string from root to the given node.
 * Example: "body > div#main > nav.sidebar"
 */
function domPath(node: DOMSnapshot, ancestors: DOMSnapshot[]): string {
  const parts: string[] = [];
  for (const a of ancestors) {
    parts.push(nodeLabel(a));
  }
  parts.push(nodeLabel(node));
  return parts.join(" > ");
}

/** Produce a concise label for a single DOM node: tag#id.className */
function nodeLabel(node: DOMSnapshot): string {
  let label = node.tag;
  if (node.id) {
    label += `#${node.id}`;
  }
  if (node.className) {
    // Collapse whitespace and join with dots
    label += "." + node.className.split(/\s+/).join(".");
  }
  return label;
}

/**
 * Build an identity key for a node so we can match elements across
 * before/after snapshots. Nodes with an `id` get that as their key;
 * otherwise we fall back to tag+className which is less unique but still
 * useful.
 */
function nodeKey(node: DOMSnapshot): string {
  if (node.id) {
    return `id:${node.id}`;
  }
  return `tag:${node.tag}|class:${node.className ?? ""}`;
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

interface FlatNode {
  node: DOMSnapshot;
  path: string;
  key: string;
}

/**
 * Recursively flatten a DOM tree into a list of FlatNode entries, each
 * carrying its identity key and human-readable path.
 */
function flattenTree(
  root: DOMSnapshot,
  ancestors: DOMSnapshot[] = [],
): FlatNode[] {
  const result: FlatNode[] = [];

  const currentPath = domPath(root, ancestors);
  result.push({ node: root, path: currentPath, key: nodeKey(root) });

  const nextAncestors = [...ancestors, root];
  for (const child of root.children) {
    result.push(...flattenTree(child, nextAncestors));
  }

  return result;
}

/** Count the total number of nodes in a DOM tree (including the root). */
function countNodes(root: DOMSnapshot): number {
  let count = 1;
  for (const child of root.children) {
    count += countNodes(child);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Comparison thresholds
// ---------------------------------------------------------------------------

/** If total element count changes by more than this ratio, flag it. */
const ELEMENT_COUNT_CHANGE_THRESHOLD = 0.20; // 20%

/** Bounding-rect shift (in px) above which we flag a layout change. */
const LAYOUT_SHIFT_PX = 50;

// ---------------------------------------------------------------------------
// Per-viewport comparison
// ---------------------------------------------------------------------------

function compareSnapshots(
  viewport: string,
  before: DOMSnapshot,
  after: DOMSnapshot,
): GateError[] {
  const errors: GateError[] = [];

  // --- Element count change ------------------------------------------------
  const beforeCount = countNodes(before);
  const afterCount = countNodes(after);

  if (beforeCount > 0) {
    const ratio = Math.abs(afterCount - beforeCount) / beforeCount;
    if (ratio > ELEMENT_COUNT_CHANGE_THRESHOLD) {
      const direction = afterCount > beforeCount ? "increase" : "decrease";
      errors.push({
        message: `[${viewport}] Significant element count ${direction}: ${beforeCount} -> ${afterCount} (${Math.round(ratio * 100)}% change)`,
        remediation: `Review the DOM on the "${viewport}" viewport — a large element count ${direction} may indicate unintended additions or removals.`,
      });
    }
  }

  // --- Flatten both trees and index by key ---------------------------------
  const beforeFlat = flattenTree(before);
  const afterFlat = flattenTree(after);

  const beforeByKey = new Map<string, FlatNode[]>();
  for (const entry of beforeFlat) {
    const existing = beforeByKey.get(entry.key);
    if (existing) {
      existing.push(entry);
    } else {
      beforeByKey.set(entry.key, [entry]);
    }
  }

  const afterByKey = new Map<string, FlatNode[]>();
  for (const entry of afterFlat) {
    const existing = afterByKey.get(entry.key);
    if (existing) {
      existing.push(entry);
    } else {
      afterByKey.set(entry.key, [entry]);
    }
  }

  // --- Missing elements (in before, not in after) --------------------------
  for (const [key, beforeEntries] of beforeByKey) {
    if (!afterByKey.has(key)) {
      // All instances of this key are missing in `after`
      for (const entry of beforeEntries) {
        errors.push({
          message: `[${viewport}] Missing element: ${entry.path}`,
          remediation: `Element ${nodeLabel(entry.node)} missing on "${viewport}" viewport — check responsive CSS rules and conditional rendering logic.`,
        });
      }
    }
  }

  // --- Added elements (in after, not in before) — informational ------------
  for (const [key, afterEntries] of afterByKey) {
    if (!beforeByKey.has(key)) {
      for (const entry of afterEntries) {
        errors.push({
          message: `[${viewport}] Added element: ${entry.path}`,
          remediation: `New element ${nodeLabel(entry.node)} detected on "${viewport}" viewport — verify this addition is intentional.`,
        });
      }
    }
  }

  // --- Visibility changes and layout shifts --------------------------------
  // For elements present in both snapshots, compare visibility and rect.
  for (const [key, beforeEntries] of beforeByKey) {
    const afterEntries = afterByKey.get(key);
    if (!afterEntries) continue;

    // Compare pairwise (first-to-first, etc.) up to the shorter list length
    const pairCount = Math.min(beforeEntries.length, afterEntries.length);
    for (let i = 0; i < pairCount; i++) {
      const bEntry = beforeEntries[i];
      const aEntry = afterEntries[i];

      // Visibility change
      if (bEntry.node.visible && !aEntry.node.visible) {
        errors.push({
          message: `[${viewport}] Element became hidden: ${bEntry.path}`,
          remediation: `Element ${nodeLabel(bEntry.node)} changed from visible to hidden on "${viewport}" viewport — check CSS display/visibility/opacity rules.`,
        });
      } else if (!bEntry.node.visible && aEntry.node.visible) {
        errors.push({
          message: `[${viewport}] Element became visible: ${bEntry.path}`,
          remediation: `Element ${nodeLabel(bEntry.node)} changed from hidden to visible on "${viewport}" viewport — verify this visibility change is intentional.`,
        });
      }

      // Layout dimension shift (only when both have rect data)
      if (bEntry.node.rect && aEntry.node.rect) {
        const bRect = bEntry.node.rect;
        const aRect = aEntry.node.rect;

        const dx = Math.abs(aRect.x - bRect.x);
        const dy = Math.abs(aRect.y - bRect.y);
        const dw = Math.abs(aRect.width - bRect.width);
        const dh = Math.abs(aRect.height - bRect.height);

        const shifts: string[] = [];
        if (dx > LAYOUT_SHIFT_PX) shifts.push(`x shifted by ${dx}px`);
        if (dy > LAYOUT_SHIFT_PX) shifts.push(`y shifted by ${dy}px`);
        if (dw > LAYOUT_SHIFT_PX) shifts.push(`width changed by ${dw}px`);
        if (dh > LAYOUT_SHIFT_PX) shifts.push(`height changed by ${dh}px`);

        if (shifts.length > 0) {
          errors.push({
            message: `[${viewport}] Layout shift on ${bEntry.path}: ${shifts.join(", ")}`,
            remediation: `Element ${nodeLabel(bEntry.node)} dimensions shifted by >${LAYOUT_SHIFT_PX}px on "${viewport}" viewport — review layout changes.`,
          });
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare before and after visual capture results using DOM structural
 * analysis. Returns a list of `GateError` entries describing detected
 * differences per viewport.
 *
 * This does NOT perform pixel-level comparison — it analyses the serialized
 * DOM trees for element count changes, missing/added elements, visibility
 * changes, and significant layout dimension shifts.
 */
export function reviewVisual(
  before: VisualCaptureResult,
  after: VisualCaptureResult,
): GateError[] {
  const errors: GateError[] = [];

  // Only compare viewports present in both snapshots
  const beforeViewports = new Set(Object.keys(before.domSnapshots));
  const afterViewports = new Set(Object.keys(after.domSnapshots));

  for (const viewport of beforeViewports) {
    if (!afterViewports.has(viewport)) continue;

    const beforeSnap = before.domSnapshots[viewport];
    const afterSnap = after.domSnapshots[viewport];

    errors.push(...compareSnapshots(viewport, beforeSnap, afterSnap));
  }

  return errors;
}
