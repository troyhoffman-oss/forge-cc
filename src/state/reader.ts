import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionContext {
  prdSlug: string;
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
  prdPath: string,
  milestoneNumber: number,
  prdSlug: string,
): Promise<SessionContext> {
  const currentMilestoneSection = await readCurrentMilestone(prdPath, milestoneNumber);
  const estimatedTokens = estimateTokens(currentMilestoneSection);

  return { prdSlug, currentMilestoneSection, estimatedTokens };
}
