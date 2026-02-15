import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { GateResult } from "../types.js";

/**
 * Reads the git diff and compares against PRD acceptance criteria
 * to check coverage. This is a heuristic check — it helps catch
 * obvious omissions but cannot verify behavior.
 */
export async function verifyPrd(
  projectDir: string,
  prdPath: string,
  baseBranch = "main",
): Promise<GateResult> {
  const start = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Read PRD content
    const prdContent = readFileSync(prdPath, "utf-8");

    // Extract acceptance criteria
    const criteria = extractCriteria(prdContent);

    if (criteria.length === 0) {
      warnings.push(
        "No acceptance criteria found in PRD (looked for checkboxes and criteria headings)",
      );
      return {
        gate: "prd",
        passed: true,
        errors,
        warnings,
        duration_ms: Date.now() - start,
      };
    }

    // Get changed file names from diff
    let changedFiles: string[];
    try {
      const nameOnly = execSync(
        `git diff ${baseBranch}...HEAD --name-only`,
        { cwd: projectDir, encoding: "utf-8", timeout: 30_000 },
      );
      changedFiles = nameOnly
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      changedFiles = [];
      warnings.push(
        "Could not get git diff — branch may not have diverged from base",
      );
    }

    // Get stat summary for additional context
    let diffStat = "";
    try {
      diffStat = execSync(`git diff ${baseBranch}...HEAD --stat`, {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 30_000,
      });
    } catch {
      // Non-critical — we still have changedFiles
    }

    if (changedFiles.length === 0 && diffStat === "") {
      warnings.push(
        "No changes detected against base branch — all criteria marked unclear",
      );
      for (const criterion of criteria) {
        warnings.push(`? ${criterion} — no changes to evaluate against`);
      }
      return {
        gate: "prd",
        passed: false,
        errors: [`No changes found to evaluate against ${criteria.length} criteria`],
        warnings,
        duration_ms: Date.now() - start,
      };
    }

    // Evaluate each criterion against the diff
    for (const criterion of criteria) {
      const result = evaluateCriterion(criterion, changedFiles);

      if (result.status === "covered") {
        warnings.push(
          `\u2713 ${criterion} — likely covered (matched: ${result.matchedFiles.join(", ")})`,
        );
      } else if (result.status === "unclear") {
        warnings.push(`? ${criterion} — could not determine coverage`);
      } else {
        errors.push(`\u2717 ${criterion} — no matching changes found`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`PRD verification failed: ${message}`);
  }

  return {
    gate: "prd",
    passed: errors.length === 0,
    errors,
    warnings,
    duration_ms: Date.now() - start,
  };
}

/**
 * Extract acceptance criteria from PRD markdown content.
 * Looks for:
 * 1. Checkbox lines: `- [ ] ...` or `- [x] ...`
 * 2. Lines under "## Acceptance Criteria" or "## User Stories" headings
 */
function extractCriteria(content: string): string[] {
  const lines = content.split("\n");
  const criteria: string[] = [];
  const seen = new Set<string>();

  let inCriteriaSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for criteria section headings
    if (/^#{1,3}\s+(acceptance\s+criteria|user\s+stories)/i.test(trimmed)) {
      inCriteriaSection = true;
      continue;
    }

    // End criteria section at next heading
    if (inCriteriaSection && /^#{1,3}\s+/.test(trimmed) && !/^#{1,3}\s+(acceptance\s+criteria|user\s+stories)/i.test(trimmed)) {
      inCriteriaSection = false;
      continue;
    }

    // Checkbox lines anywhere in the document
    const checkboxMatch = trimmed.match(/^-\s+\[[ x]\]\s+(.+)/i);
    if (checkboxMatch) {
      const text = checkboxMatch[1].trim();
      if (!seen.has(text)) {
        seen.add(text);
        criteria.push(text);
      }
      continue;
    }

    // Bullet points under a criteria section heading
    if (inCriteriaSection) {
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      if (bulletMatch) {
        const text = bulletMatch[1].trim();
        if (!seen.has(text)) {
          seen.add(text);
          criteria.push(text);
        }
      }
    }
  }

  return criteria;
}

interface CriterionEvaluation {
  status: "covered" | "not_covered" | "unclear";
  matchedFiles: string[];
}

/**
 * Heuristic evaluation of whether a criterion is covered by the diff.
 * Extracts keywords from the criterion and matches against changed file paths.
 */
function evaluateCriterion(
  criterion: string,
  changedFiles: string[],
): CriterionEvaluation {
  // Extract meaningful keywords (3+ chars, not common words)
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "has",
    "her", "was", "one", "our", "out", "its", "his", "how", "its", "may",
    "who", "did", "get", "let", "say", "she", "too", "use", "way", "each",
    "which", "their", "will", "other", "about", "many", "then", "them",
    "been", "have", "from", "with", "they", "this", "that", "what", "when",
    "make", "like", "just", "over", "such", "take", "into", "than", "most",
    "also", "should", "would", "could", "must", "shall", "might", "does",
    "display", "show", "page", "user", "view", "click", "able", "ensure",
    "given", "when", "then",
  ]);

  const keywords = criterion
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  if (keywords.length === 0) {
    return { status: "unclear", matchedFiles: [] };
  }

  // Match keywords against file paths
  const matchedFiles: string[] = [];

  for (const file of changedFiles) {
    const fileLower = file.toLowerCase();
    // Extract file name parts (split on /, ., -, _)
    const fileParts = fileLower.split(/[/.\-_]/).filter(Boolean);

    for (const keyword of keywords) {
      if (
        fileLower.includes(keyword) ||
        fileParts.some((part) => part.includes(keyword) || keyword.includes(part))
      ) {
        matchedFiles.push(file);
        break;
      }
    }
  }

  if (matchedFiles.length > 0) {
    // Cap displayed files at 3 for readability
    const displayFiles = matchedFiles.length > 3
      ? [...matchedFiles.slice(0, 3), `+${matchedFiles.length - 3} more`]
      : matchedFiles;
    return { status: "covered", matchedFiles: displayFiles };
  }

  // If no files matched but there are very few keywords, mark as unclear
  if (keywords.length <= 2) {
    return { status: "unclear", matchedFiles: [] };
  }

  return { status: "not_covered", matchedFiles: [] };
}
