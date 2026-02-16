/**
 * PRD Queue — Multi-PRD Execution Queue Manager
 *
 * Scans all PRDs, determines which have pending milestones, and tracks
 * which PRDs are currently being executed by active sessions.
 * Used by `npx forge run --all` to dispatch parallel PRD execution.
 */

import {
  discoverPRDs,
  findNextPendingMilestone,
  countPendingMilestones,
} from "../state/prd-status.js";
import { getActiveSessions } from "../worktree/session.js";
import { getRepoRoot } from "../worktree/manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRDQueueEntry {
  slug: string;
  project: string;
  branch: string;
  pendingMilestones: number;
  nextMilestone: number | null;
  isExecuting: boolean;
}

// ---------------------------------------------------------------------------
// PRDQueue
// ---------------------------------------------------------------------------

export class PRDQueue {
  private projectDir: string;
  private repoRoot: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.repoRoot = getRepoRoot(projectDir);
  }

  /**
   * Scan all PRDs and return queue entries with execution status.
   *
   * For each discovered PRD:
   * - Counts pending milestones
   * - Finds the next pending milestone number
   * - Checks the session registry for active sessions with a matching prdSlug
   */
  async scanPRDs(): Promise<PRDQueueEntry[]> {
    const prds = await discoverPRDs(this.projectDir);
    const entries: PRDQueueEntry[] = [];

    for (const prd of prds) {
      const pending = await countPendingMilestones(this.projectDir, prd.slug);
      const nextPending = await findNextPendingMilestone(
        this.projectDir,
        prd.slug,
      );

      entries.push({
        slug: prd.slug,
        project: prd.status.project,
        branch: prd.status.branch,
        pendingMilestones: pending,
        nextMilestone: nextPending ? nextPending.number : null,
        isExecuting: this.isExecuting(prd.slug),
      });
    }

    return entries;
  }

  /**
   * Get PRDs that are ready to execute.
   *
   * A PRD is ready when it has pending milestones and is not currently
   * being executed by any active session.
   */
  async getReadyPRDs(): Promise<PRDQueueEntry[]> {
    const all = await this.scanPRDs();
    return all.filter(
      (entry) => entry.pendingMilestones > 0 && !entry.isExecuting,
    );
  }

  /**
   * Check if a PRD is currently being executed by any active session.
   *
   * Loads the session registry and checks for active sessions whose
   * `prdSlug` field matches the given slug.
   */
  isExecuting(slug: string): boolean {
    const activeSessions = getActiveSessions(this.repoRoot);
    return activeSessions.some(
      (session) => session.prdSlug === slug,
    );
  }
}
