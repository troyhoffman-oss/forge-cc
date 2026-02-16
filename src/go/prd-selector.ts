/**
 * PRD Selector — Discovery and Presentation for PRD Picking
 *
 * Wraps the low-level prd-status module to provide higher-level functions
 * for the /forge:go skill's PRD selection UI. Discovers PRDs with pending
 * milestones, formats them for AskUserQuestion pickers, and handles
 * single-PRD auto-selection.
 */

import { discoverPRDs } from "../state/prd-status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingPRD {
  slug: string;
  project: string;
  branch: string;
  pendingCount: number;
  completeCount: number;
  totalCount: number;
}

export interface PRDPickerOption {
  label: string;
  description: string;
}

export interface ModePickerOption {
  label: string;
  description: string;
}

export interface SelectPRDResult {
  prd: PendingPRD;
  autoSelected: boolean;
}

// ---------------------------------------------------------------------------
// discoverPendingPRDs
// ---------------------------------------------------------------------------

/**
 * Discover all PRDs that have at least one pending milestone.
 *
 * Wraps `discoverPRDs()` from prd-status, filters to those with pending
 * milestones, and computes completion counts for each.
 */
export async function discoverPendingPRDs(
  projectDir: string,
): Promise<PendingPRD[]> {
  const allPRDs = await discoverPRDs(projectDir);

  const pending: PendingPRD[] = [];

  for (const entry of allPRDs) {
    const milestones = Object.values(entry.status.milestones);
    const totalCount = milestones.length;
    const pendingCount = milestones.filter(
      (m) => m.status === "pending",
    ).length;
    const completeCount = milestones.filter(
      (m) => m.status === "complete",
    ).length;

    if (pendingCount > 0) {
      pending.push({
        slug: entry.slug,
        project: entry.status.project,
        branch: entry.status.branch,
        pendingCount,
        completeCount,
        totalCount,
      });
    }
  }

  return pending;
}

// ---------------------------------------------------------------------------
// presentPRDPicker
// ---------------------------------------------------------------------------

/**
 * Format pending PRDs as label/description pairs for AskUserQuestion.
 *
 * Each option shows the project name, branch, and milestone progress.
 * Example label: "forge-agent-teams (2/5 complete)"
 * Example description: "Branch: feat/agent-teams | 3 milestones remaining"
 */
export function presentPRDPicker(prds: PendingPRD[]): PRDPickerOption[] {
  return prds.map((prd) => ({
    label: `${prd.project} (${prd.completeCount}/${prd.totalCount} complete)`,
    description: `Branch: ${prd.branch} | ${prd.pendingCount} milestone${prd.pendingCount === 1 ? "" : "s"} remaining`,
  }));
}

// ---------------------------------------------------------------------------
// presentModePicker
// ---------------------------------------------------------------------------

/**
 * Return the two execution mode options for AskUserQuestion.
 *
 * - "Single milestone" — execute one milestone, then stop for review
 * - "Auto (all milestones)" — chain through all pending milestones
 */
export function presentModePicker(): ModePickerOption[] {
  return [
    {
      label: "Single milestone",
      description:
        "Execute the next pending milestone, then stop for review",
    },
    {
      label: "Auto (all milestones)",
      description:
        "Chain through all pending milestones with fresh context resets",
    },
  ];
}

// ---------------------------------------------------------------------------
// selectPRD
// ---------------------------------------------------------------------------

/**
 * Convenience function: discover pending PRDs and auto-select if only one.
 *
 * Returns the selected PRD and whether it was auto-selected (skipping the
 * picker). Returns null if no PRDs have pending milestones.
 */
export async function selectPRD(
  projectDir: string,
): Promise<SelectPRDResult | null> {
  const pending = await discoverPendingPRDs(projectDir);

  if (pending.length === 0) {
    return null;
  }

  if (pending.length === 1) {
    return { prd: pending[0], autoSelected: true };
  }

  // Multiple PRDs — caller must present the picker and resolve selection.
  // Return the first one with autoSelected: false to signal that the caller
  // should use presentPRDPicker() to let the user choose.
  // The caller is responsible for mapping the user's selection back to the
  // correct PendingPRD from the discoverPendingPRDs() result.
  return null;
}
