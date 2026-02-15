import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StateInfo {
  currentMilestone: { number: number; name: string } | null;
  branch: string | null;
  lastSession: string | null;
  nextActions: string[];
  raw: string;
}

export interface MilestoneProgress {
  number: number;
  name: string;
  status: string;
}

export interface RoadmapInfo {
  milestones: MilestoneProgress[];
  raw: string;
}

export interface SessionContext {
  state: StateInfo | null;
  roadmap: RoadmapInfo | null;
  currentMilestoneSection: string | null;
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

function estimateTokens(...texts: (string | null | undefined)[]): number {
  let chars = 0;
  for (const t of texts) {
    if (t) chars += t.length;
  }
  return Math.ceil(chars / 4);
}

// ---------------------------------------------------------------------------
// readStateFile
// ---------------------------------------------------------------------------

export async function readStateFile(
  projectDir: string,
): Promise<StateInfo | null> {
  const raw = await safeRead(join(projectDir, ".planning", "STATE.md"));
  if (raw === null) return null;

  // Extract milestone: "Milestone 2 — Linear Integration + Triage Skill"
  let currentMilestone: StateInfo["currentMilestone"] = null;
  const milestoneMatch = raw.match(
    /\*\*Milestone:\*\*\s*Milestone\s+(\d+)\s*[—–-]\s*(.+)/,
  );
  if (milestoneMatch) {
    currentMilestone = {
      number: parseInt(milestoneMatch[1], 10),
      name: milestoneMatch[2].trim(),
    };
  }

  // Extract branch
  let branch: string | null = null;
  const branchMatch = raw.match(/\*\*Branch:\*\*\s*`?([^\s`]+)`?/);
  if (branchMatch) {
    branch = branchMatch[1];
  }

  // Extract last session date
  let lastSession: string | null = null;
  const sessionMatch = raw.match(/\*\*Last Session:\*\*\s*(\S+)/);
  if (sessionMatch) {
    lastSession = sessionMatch[1];
  }

  // Extract next actions — numbered list items after "## Next Actions"
  const nextActions: string[] = [];
  const actionsSection = raw.match(
    /##\s*Next Actions\s*\n([\s\S]*?)(?=\n##\s|\n---|\s*$)/,
  );
  if (actionsSection) {
    const lines = actionsSection[1].split("\n");
    for (const line of lines) {
      const item = line.match(/^\s*\d+\.\s+(.+)/);
      if (item) {
        nextActions.push(item[1].trim());
      }
    }
  }

  return { currentMilestone, branch, lastSession, nextActions, raw };
}

// ---------------------------------------------------------------------------
// readRoadmapProgress
// ---------------------------------------------------------------------------

export async function readRoadmapProgress(
  projectDir: string,
): Promise<RoadmapInfo | null> {
  const raw = await safeRead(join(projectDir, ".planning", "ROADMAP.md"));
  if (raw === null) return null;

  const milestones: MilestoneProgress[] = [];

  // Match table rows: | 1 | Core CLI + Verification Engine | Complete (2026-02-15) |
  const tableRowRe = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = tableRowRe.exec(raw)) !== null) {
    // Skip the header separator row (contains dashes)
    if (match[2].includes("---")) continue;
    // Skip the header row itself
    if (match[1] === "Milestone" || match[2] === "Name") continue;

    milestones.push({
      number: parseInt(match[1], 10),
      name: match[2].trim(),
      status: match[3].trim(),
    });
  }

  return { milestones, raw };
}

// ---------------------------------------------------------------------------
// readCurrentMilestone
// ---------------------------------------------------------------------------

export async function readCurrentMilestone(
  prdPath: string,
  milestoneNumber: number,
): Promise<string | null> {
  const raw = await safeRead(prdPath);
  if (raw === null) return null;

  // Look for "### Milestone {n}:" header and extract until next milestone or separator
  const pattern = new RegExp(
    `(###\\s*Milestone\\s+${milestoneNumber}\\s*[:\\—–-][\\s\\S]*?)(?=\\n###\\s*Milestone\\s+\\d|\\n---|$)`,
  );
  const match = raw.match(pattern);
  if (!match) return null;

  return match[1].trim();
}

// ---------------------------------------------------------------------------
// readSessionContext
// ---------------------------------------------------------------------------

export async function readSessionContext(
  projectDir: string,
  prdPath: string,
  milestoneNumber: number,
): Promise<SessionContext> {
  const [state, roadmap, currentMilestoneSection] = await Promise.all([
    readStateFile(projectDir),
    readRoadmapProgress(projectDir),
    readCurrentMilestone(prdPath, milestoneNumber),
  ]);

  const estimatedTokens = estimateTokens(
    state?.raw,
    roadmap?.raw,
    currentMilestoneSection,
  );

  return { state, roadmap, currentMilestoneSection, estimatedTokens };
}
