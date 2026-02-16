import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../utils/platform.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeResult {
  stateUpdated: boolean;
  roadmapUpdated: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// mergeSessionState
// ---------------------------------------------------------------------------

/**
 * Merge state from a completed worktree session back to the main repo.
 *
 * - STATE.md: updates the milestone row with completion status and the
 *   Last Session date.
 * - ROADMAP.md: marks the milestone row as complete with the given date.
 *
 * Uses synchronous I/O throughout — consistent with all other worktree modules.
 *
 * @param mainRepoDir - Absolute path to the main repository
 * @param worktreeDir - Absolute path to the completed worktree
 * @param milestoneNumber - The milestone that was completed
 * @param completionDate - Date string (YYYY-MM-DD) for the completion
 */
export function mergeSessionState(
  mainRepoDir: string,
  worktreeDir: string,
  milestoneNumber: number,
  completionDate: string,
): MergeResult {
  const warnings: string[] = [];
  let stateUpdated = false;
  let roadmapUpdated = false;

  const completionStatus = `Complete (${completionDate})`;

  // --- Check that the worktree has planning files --------------------------
  const worktreeStatePath = join(worktreeDir, ".planning", "STATE.md");
  const worktreeRoadmapPath = join(worktreeDir, ".planning", "ROADMAP.md");

  if (!existsSync(worktreeStatePath)) {
    warnings.push(
      `Worktree STATE.md not found at ${worktreeStatePath} — skipping state merge`,
    );
  }
  if (!existsSync(worktreeRoadmapPath)) {
    warnings.push(
      `Worktree ROADMAP.md not found at ${worktreeRoadmapPath} — skipping roadmap merge`,
    );
  }

  // --- Update main repo STATE.md ------------------------------------------
  const mainStatePath = join(mainRepoDir, ".planning", "STATE.md");

  if (existsSync(mainStatePath)) {
    const milestoneUpdated = updateStateMilestoneRow(
      mainStatePath,
      milestoneNumber,
      completionStatus,
    );

    if (milestoneUpdated) {
      stateUpdated = true;
    } else {
      warnings.push(
        `Milestone ${milestoneNumber} row not found in main repo STATE.md — no state update performed`,
      );
    }
  } else {
    warnings.push(
      `Main repo STATE.md not found at ${mainStatePath} — cannot update state`,
    );
  }

  // --- Update main repo ROADMAP.md ----------------------------------------
  const mainRoadmapPath = join(mainRepoDir, ".planning", "ROADMAP.md");

  if (existsSync(mainRoadmapPath)) {
    const milestoneUpdated = updateRoadmapMilestoneStatus(
      mainRoadmapPath,
      milestoneNumber,
      completionStatus,
    );

    if (milestoneUpdated) {
      roadmapUpdated = true;
    } else {
      warnings.push(
        `Milestone ${milestoneNumber} row not found in main repo ROADMAP.md — no roadmap update performed`,
      );
    }
  } else {
    warnings.push(
      `Main repo ROADMAP.md not found at ${mainRoadmapPath} — cannot update roadmap`,
    );
  }

  return { stateUpdated, roadmapUpdated, warnings };
}

// ---------------------------------------------------------------------------
// updateRoadmapMilestoneStatus
// ---------------------------------------------------------------------------

/**
 * Update a specific milestone row in a ROADMAP.md file.
 * Uses structured line-by-line parsing (not regex replace) to safely
 * update the status column of the milestone's table row.
 *
 * @param roadmapPath - Absolute path to ROADMAP.md
 * @param milestoneNumber - Which milestone to update
 * @param newStatus - New status string (e.g., "Complete (2026-02-15)")
 * @returns true if the milestone was found and updated
 */
export function updateRoadmapMilestoneStatus(
  roadmapPath: string,
  milestoneNumber: number,
  newStatus: string,
): boolean {
  const content = readFileSync(roadmapPath, "utf-8");
  const lines = content.split("\n");

  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match table rows: | <number> | <name> | <status> |
    // Cells are separated by |. Split and check the first data cell.
    if (!line.trimStart().startsWith("|")) continue;

    const cells = line.split("|");
    // A valid table row split by | produces: ["", " cell1 ", " cell2 ", " cell3 ", ""]
    // We need at least 4 separators (5 segments) for a 3-column table row.
    if (cells.length < 5) continue;

    const firstCell = cells[1].trim();
    const parsedNumber = parseInt(firstCell, 10);

    if (isNaN(parsedNumber) || parsedNumber !== milestoneNumber) continue;

    // Check if this is already completed — if so, last completer wins with warning.
    const currentStatus = cells[3].trim();
    const alreadyComplete = currentStatus.toLowerCase().startsWith("complete");

    // Update the status cell (index 3), preserving cell padding.
    cells[3] = ` ${newStatus} `;
    lines[i] = cells.join("|");
    found = true;

    if (alreadyComplete) {
      // Last completer wins — overwrite is intentional but callers may
      // want to know. We still return true since the update was applied.
    }

    break;
  }

  if (found) {
    atomicWriteFileSync(roadmapPath, lines.join("\n"));
  }

  return found;
}

// ---------------------------------------------------------------------------
// updateStateMilestoneRow
// ---------------------------------------------------------------------------

/**
 * Update the milestone progress table in STATE.md.
 * Reads the current STATE.md, finds the milestone row, updates its status.
 * Also updates the `**Last Session:**` date if present.
 * Preserves all other content.
 *
 * @param statePath - Absolute path to STATE.md
 * @param milestoneNumber - Which milestone to update
 * @param newStatus - New status string
 * @returns true if the milestone was found and updated
 */
export function updateStateMilestoneRow(
  statePath: string,
  milestoneNumber: number,
  newStatus: string,
): boolean {
  const content = readFileSync(statePath, "utf-8");
  const lines = content.split("\n");

  let milestoneFound = false;

  // Extract the date from the status string for Last Session update.
  // Status format is typically "Complete (YYYY-MM-DD)".
  const dateMatch = newStatus.match(/\((\d{4}-\d{2}-\d{2})\)/);
  const completionDate = dateMatch ? dateMatch[1] : null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Update milestone table row ----------------------------------------
    if (line.trimStart().startsWith("|")) {
      const cells = line.split("|");

      if (cells.length >= 5) {
        const firstCell = cells[1].trim();
        const parsedNumber = parseInt(firstCell, 10);

        if (!isNaN(parsedNumber) && parsedNumber === milestoneNumber) {
          cells[3] = ` ${newStatus} `;
          lines[i] = cells.join("|");
          milestoneFound = true;
        }
      }
    }

    // --- Update Last Session date ------------------------------------------
    if (completionDate && line.match(/\*\*Last Session:\*\*/)) {
      lines[i] = line.replace(
        /(\*\*Last Session:\*\*\s*)\S+/,
        `$1${completionDate}`,
      );
    }
  }

  if (milestoneFound) {
    atomicWriteFileSync(statePath, lines.join("\n"));
  }

  return milestoneFound;
}
