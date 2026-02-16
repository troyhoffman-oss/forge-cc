import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GateError, ReviewResult } from "../types.js";

/** Options for the review gate */
export interface ReviewOptions {
  prdPath?: string;
  claudeMdPath?: string;
  baseBranch?: string;
  blocking?: boolean;
}

/** A single review finding before it is classified as error/warning */
interface ReviewFinding {
  type: "prd_compliance" | "rule_violation" | "style";
  severity: "error" | "warning";
  file?: string;
  line?: number;
  message: string;
  remediation: string;
  source: string;
}

/** Parsed diff hunk with file and line information */
interface DiffHunk {
  file: string;
  startLine: number;
  content: string;
  addedLines: Array<{ line: number; text: string }>;
  removedLines: Array<{ line: number; text: string }>;
}

/**
 * Code review gate: evaluates the current diff against PRD acceptance criteria
 * and CLAUDE.md coding rules to produce structured review findings.
 *
 * Non-blocking by default (returns passed: true with warnings).
 * Set blocking: true to fail the gate when findings exist.
 */
export async function verifyReview(
  projectDir: string,
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const start = Date.now();
  const errors: GateError[] = [];
  const warnings: string[] = [];
  const reviewFindings: ReviewFinding[] = [];

  const { prdPath, claudeMdPath, baseBranch, blocking = false } = options;

  try {
    // 1. Get the diff content
    const diffContent = getDiffContent(projectDir, baseBranch);

    if (!diffContent) {
      warnings.push("No diff content available -- nothing to review");
      return buildResult(true, errors, warnings, reviewFindings, start);
    }

    // 2. Parse diff into structured hunks
    const hunks = parseDiffHunks(diffContent);

    if (hunks.length === 0) {
      warnings.push("Diff parsed but no hunks found -- nothing to review");
      return buildResult(true, errors, warnings, reviewFindings, start);
    }

    // 3. Extract review checklist from PRD
    const prdCriteria = extractPrdCriteria(prdPath, projectDir);

    // 4. Extract coding rules from CLAUDE.md
    const claudeRules = extractClaudeRules(claudeMdPath, projectDir);

    // 5. Evaluate diff against PRD criteria
    for (const criterion of prdCriteria) {
      const finding = evaluatePrdCriterion(criterion, hunks);
      if (finding) {
        reviewFindings.push(finding);
      }
    }

    // 6. Evaluate diff against CLAUDE.md rules
    for (const rule of claudeRules) {
      const findings = evaluateClaudeRule(rule, hunks);
      reviewFindings.push(...findings);
    }

    // 7. Run structural style checks on the diff
    const styleFindings = evaluateStyleRules(hunks);
    reviewFindings.push(...styleFindings);

    // 8. Convert findings to GateErrors and warnings
    for (const finding of reviewFindings) {
      if (finding.severity === "error") {
        errors.push({
          file: finding.file,
          line: finding.line,
          message: finding.message,
          remediation: finding.remediation,
        });
      } else {
        warnings.push(
          `${finding.file ? `${finding.file}` : ""}${finding.line ? `:${finding.line}` : ""} ${finding.message} [${finding.source}]`,
        );
      }
    }

    // Non-blocking by default: pass even if there are errors, unless blocking is true
    const passed = blocking ? errors.length === 0 : true;

    if (!blocking && errors.length > 0) {
      warnings.push(
        `Review gate found ${errors.length} issue(s) but is non-blocking. Set review.blocking: true in .forge.json to enforce.`,
      );
    }

    return buildResult(passed, errors, warnings, reviewFindings, start);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ message: `Review gate failed: ${message}` });
    return buildResult(!blocking, errors, warnings, reviewFindings, start);
  }
}

// ---------------------------------------------------------------------------
// Diff Retrieval
// ---------------------------------------------------------------------------

function getDiffContent(projectDir: string, baseBranch?: string): string | null {
  // Try diff against base branch first if provided
  if (baseBranch) {
    try {
      const diff = execSync(`git diff ${baseBranch}...HEAD`, {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 30_000,
      });
      if (diff.trim()) return diff;
    } catch {
      // Fall through to other strategies
    }
  }

  // Try HEAD~1 (last commit's diff)
  try {
    const diff = execSync("git diff HEAD~1", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (diff.trim()) return diff;
  } catch {
    // Fall through
  }

  // Try staged changes
  try {
    const diff = execSync("git diff --cached", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (diff.trim()) return diff;
  } catch {
    // Fall through
  }

  // Try unstaged changes
  try {
    const diff = execSync("git diff", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (diff.trim()) return diff;
  } catch {
    // Nothing available
  }

  return null;
}

// ---------------------------------------------------------------------------
// Diff Parsing
// ---------------------------------------------------------------------------

const DIFF_FILE_RE = /^diff --git a\/(.+?) b\/(.+?)$/;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseDiffHunks(diffContent: string): DiffHunk[] {
  const lines = diffContent.split("\n");
  const hunks: DiffHunk[] = [];

  let currentFile = "";
  let currentHunk: DiffHunk | null = null;
  let currentLine = 0;

  for (const line of lines) {
    // New file header
    const fileMatch = line.match(DIFF_FILE_RE);
    if (fileMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentFile = fileMatch[2];
      currentHunk = null;
      continue;
    }

    // New hunk header
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentLine = parseInt(hunkMatch[1], 10);
      currentHunk = {
        file: currentFile,
        startLine: currentLine,
        content: "",
        addedLines: [],
        removedLines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    currentHunk.content += line + "\n";

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.addedLines.push({ line: currentLine, text: line.slice(1) });
      currentLine++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.removedLines.push({ line: currentLine, text: line.slice(1) });
      // Removed lines don't advance the new-file line counter
    } else {
      // Context line
      currentLine++;
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

// ---------------------------------------------------------------------------
// PRD Criteria Extraction
// ---------------------------------------------------------------------------

interface PrdCriterion {
  text: string;
  section: string;
  checked: boolean;
}

function extractPrdCriteria(prdPath: string | undefined, projectDir: string): PrdCriterion[] {
  const criteria: PrdCriterion[] = [];

  const resolvedPath = prdPath
    ? (prdPath.startsWith("/") || prdPath.includes(":") ? prdPath : join(projectDir, prdPath))
    : null;

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return criteria;
  }

  try {
    const content = readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    let currentSection = "General";

    for (const line of lines) {
      const trimmed = line.trim();

      // Track section headings
      const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) {
        currentSection = headingMatch[1].trim();
        continue;
      }

      // Checkbox lines
      const checkboxMatch = trimmed.match(/^-\s+\[([ x])\]\s+(.+)/i);
      if (checkboxMatch) {
        criteria.push({
          text: checkboxMatch[2].trim(),
          section: currentSection,
          checked: checkboxMatch[1].toLowerCase() === "x",
        });
      }
    }
  } catch {
    // PRD unreadable -- skip
  }

  return criteria;
}

// ---------------------------------------------------------------------------
// CLAUDE.md Rule Extraction
// ---------------------------------------------------------------------------

interface ClaudeRule {
  text: string;
  tag?: string; // e.g., "[agent staging]"
  section: string;
}

function extractClaudeRules(claudeMdPath: string | undefined, projectDir: string): ClaudeRule[] {
  const rules: ClaudeRule[] = [];

  // Try explicit path, then look in projectDir, then projectDir/CLAUDE.md
  const candidates = [
    claudeMdPath,
    join(projectDir, "CLAUDE.md"),
  ].filter((p): p is string => !!p);

  let content: string | null = null;
  for (const candidate of candidates) {
    const resolved = candidate.startsWith("/") || candidate.includes(":")
      ? candidate
      : join(projectDir, candidate);
    if (existsSync(resolved)) {
      try {
        content = readFileSync(resolved, "utf-8");
        break;
      } catch {
        continue;
      }
    }
  }

  if (!content) return rules;

  const lines = content.split("\n");
  let currentSection = "";
  let inRulesSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track section headings
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      // Detect rule-related sections
      inRulesSection = /rules|principles|execution|verification|learned/i.test(currentSection);
      continue;
    }

    if (!inRulesSection) continue;

    // Bullet points with optional tags like [agent staging]
    const bulletMatch = trimmed.match(/^[-*]\s+(?:\*\*\[([^\]]+)\]\*\*\s*)?(.+)/);
    if (bulletMatch) {
      const tag = bulletMatch[1] ?? undefined;
      const text = bulletMatch[2].trim();

      // Skip lines that are just formatting or too short to be a rule
      if (text.length < 10) continue;

      rules.push({
        text,
        tag: tag ? `[${tag}]` : undefined,
        section: currentSection,
      });
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// PRD Criterion Evaluation
// ---------------------------------------------------------------------------

function evaluatePrdCriterion(criterion: PrdCriterion, hunks: DiffHunk[]): ReviewFinding | null {
  // If the criterion is already checked, we do a lighter check
  // For unchecked criteria, we check if the diff addresses them

  // Extract keywords from the criterion
  const keywords = extractKeywords(criterion.text);

  if (keywords.length === 0) return null;

  // Search hunks for keyword presence
  let matched = false;
  for (const hunk of hunks) {
    const hunkText = hunk.content.toLowerCase();
    const fileText = hunk.file.toLowerCase();

    const keywordHits = keywords.filter(
      (kw) => hunkText.includes(kw) || fileText.includes(kw),
    );

    // Require at least 40% of keywords to match
    if (keywordHits.length >= Math.ceil(keywords.length * 0.4)) {
      matched = true;
      break;
    }
  }

  if (!matched && !criterion.checked) {
    return {
      type: "prd_compliance",
      severity: "error",
      message: `PRD criterion may not be addressed: "${criterion.text}"`,
      remediation: `Review PRD section "${criterion.section}" and ensure this criterion is covered by the current changes.`,
      source: `PRD: ${criterion.section}`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// CLAUDE.md Rule Evaluation
// ---------------------------------------------------------------------------

function evaluateClaudeRule(rule: ClaudeRule, hunks: DiffHunk[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const ruleTextLower = rule.text.toLowerCase();

  // Check for specific patterns in rules that can be mechanically verified
  const checks = getRuleChecks(rule);

  for (const check of checks) {
    for (const hunk of hunks) {
      for (const addedLine of hunk.addedLines) {
        if (check.pattern.test(addedLine.text)) {
          findings.push({
            type: "rule_violation",
            severity: check.severity,
            file: hunk.file,
            line: addedLine.line,
            message: check.message,
            remediation: check.remediation,
            source: rule.tag
              ? `CLAUDE.md: ${rule.tag}`
              : `CLAUDE.md: ${rule.section}`,
          });
        }
      }
    }
  }

  // Heuristic: if rule mentions "never" or "always" + a keyword, scan for violations
  if (/\bnever\b/i.test(ruleTextLower)) {
    const neverMatch = ruleTextLower.match(/never\s+(?:use\s+)?(.+?)(?:\.|$)/i);
    if (neverMatch) {
      const forbidden = neverMatch[1].trim().replace(/[^a-z0-9\s-]/g, "").trim();
      if (forbidden.length >= 3) {
        for (const hunk of hunks) {
          for (const addedLine of hunk.addedLines) {
            if (addedLine.text.toLowerCase().includes(forbidden)) {
              // Avoid duplicate with explicit checks
              if (!findings.some((f) => f.file === hunk.file && f.line === addedLine.line)) {
                findings.push({
                  type: "rule_violation",
                  severity: "warning",
                  file: hunk.file,
                  line: addedLine.line,
                  message: `Possible violation: "${rule.text}"`,
                  remediation: `Review this line against CLAUDE.md rule in section "${rule.section}".`,
                  source: rule.tag
                    ? `CLAUDE.md: ${rule.tag}`
                    : `CLAUDE.md: ${rule.section}`,
                });
              }
            }
          }
        }
      }
    }
  }

  return findings;
}

/** Map known rule patterns to mechanical checks */
function getRuleChecks(rule: ClaudeRule): Array<{
  pattern: RegExp;
  message: string;
  remediation: string;
  severity: "error" | "warning";
}> {
  const checks: Array<{
    pattern: RegExp;
    message: string;
    remediation: string;
    severity: "error" | "warning";
  }> = [];

  const text = rule.text.toLowerCase();

  // [agent staging] -- detect `git add .` or `git add -A`
  if (text.includes("git add") || (rule.tag && rule.tag.includes("staging"))) {
    checks.push({
      pattern: /git\s+add\s+(?:\.|--all|-A)\b/,
      message: "Uses 'git add .' or 'git add -A' which can disrupt parallel agents' git index.",
      remediation: "Stage specific files instead of using broad git add commands.",
      severity: "error",
    });
  }

  // Check for console.log left in code
  if (text.includes("console") || text.includes("debug")) {
    checks.push({
      pattern: /console\.log\(/,
      message: "console.log() left in code -- consider removing debug output.",
      remediation: "Remove console.log statements before committing, or use a proper logger.",
      severity: "error",
    });
  }

  // Check for relative imports without .js extension (ES module rule)
  if (text.includes(".js extension") || text.includes("es module")) {
    checks.push({
      pattern: /from\s+["'][.][^"']*(?<!\.js)["']/,
      message: "Relative import missing .js extension (ES module requirement).",
      remediation: "Add .js extension to all relative imports per ES module convention.",
      severity: "error",
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Style Checks
// ---------------------------------------------------------------------------

function evaluateStyleRules(hunks: DiffHunk[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const hunk of hunks) {
    // Only check TypeScript/JavaScript files
    if (!/\.[tj]sx?$/.test(hunk.file)) continue;

    for (const addedLine of hunk.addedLines) {
      const text = addedLine.text;

      // Check for `any` type usage in TypeScript
      if (/:\s*any\b/.test(text) && !text.includes("// eslint-disable") && !text.includes("@ts-")) {
        findings.push({
          type: "style",
          severity: "warning",
          file: hunk.file,
          line: addedLine.line,
          message: "Explicit 'any' type used -- consider using a more specific type.",
          remediation: "Replace 'any' with a specific type or 'unknown' for type safety.",
          source: "Style: TypeScript strict mode",
        });
      }

      // Check for TODO/FIXME/HACK left in code
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(text)) {
        findings.push({
          type: "style",
          severity: "warning",
          file: hunk.file,
          line: addedLine.line,
          message: "TODO/FIXME/HACK marker found in new code.",
          remediation: "Resolve the TODO or track it as a separate issue before merging.",
          source: "Style: code cleanliness",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "has",
  "her", "was", "one", "our", "out", "its", "his", "how", "may", "who",
  "did", "get", "let", "say", "she", "too", "use", "way", "each",
  "which", "their", "will", "other", "about", "many", "then", "them",
  "been", "have", "from", "with", "they", "this", "that", "what", "when",
  "make", "like", "just", "over", "such", "take", "into", "than", "most",
  "also", "should", "would", "could", "must", "shall", "might", "does",
  "display", "show", "page", "user", "view", "click", "able", "ensure",
  "given",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function buildResult(
  passed: boolean,
  errors: GateError[],
  warnings: string[],
  reviewFindings: ReviewFinding[],
  start: number,
): ReviewResult {
  return {
    gate: "review",
    passed,
    errors,
    warnings,
    duration_ms: Date.now() - start,
    reviewFindings,
  };
}
