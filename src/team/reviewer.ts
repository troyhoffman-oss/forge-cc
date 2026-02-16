import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./types.js";

// ---------------------------------------------------------------------------
// Local Types
// ---------------------------------------------------------------------------

interface DiffHunk {
  file: string;
  startLine: number;
  content: string;
  addedLines: Array<{ line: number; text: string }>;
  removedLines: Array<{ line: number; text: string }>;
}

interface ReviewWaveDiffOptions {
  projectDir: string;
  prdPath?: string;
  claudeMdPath?: string;
  baseBranch?: string;
}

// ---------------------------------------------------------------------------
// Diff Parsing (local copy — review-gate.ts does not export these)
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
      currentHunk.removedLines.push({
        line: currentLine,
        text: line.slice(1),
      });
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
// Diff Retrieval
// ---------------------------------------------------------------------------

function getDiffContent(
  projectDir: string,
  baseBranch?: string,
): string | null {
  const execOpts = { cwd: projectDir, encoding: "utf-8" as const, timeout: 30_000 };

  // Try diff against base branch first if provided
  if (baseBranch) {
    try {
      const diff = execSync(`git diff ${baseBranch}...HEAD`, execOpts);
      if (diff.trim()) return diff;
    } catch {
      // Fall through to other strategies
    }
  }

  // Try HEAD~1 (last commit's diff)
  try {
    const diff = execSync("git diff HEAD~1", execOpts);
    if (diff.trim()) return diff;
  } catch {
    // Fall through
  }

  // Try staged changes
  try {
    const diff = execSync("git diff --cached", execOpts);
    if (diff.trim()) return diff;
  } catch {
    // Fall through
  }

  // Try unstaged changes
  try {
    const diff = execSync("git diff", execOpts);
    if (diff.trim()) return diff;
  } catch {
    // Nothing available
  }

  return null;
}

// ---------------------------------------------------------------------------
// PRD Checklist Extraction
// ---------------------------------------------------------------------------

function extractPrdChecklist(
  prdPath: string | undefined,
  projectDir: string,
): Array<{ text: string; section: string }> {
  const checklist: Array<{ text: string; section: string }> = [];

  if (!prdPath) return checklist;

  const resolvedPath =
    prdPath.startsWith("/") || prdPath.includes(":")
      ? prdPath
      : join(projectDir, prdPath);

  if (!existsSync(resolvedPath)) return checklist;

  try {
    const content = readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    let currentSection = "General";

    for (const line of lines) {
      const trimmed = line.trim();

      // Track section headings (## or ###)
      const headingMatch = trimmed.match(/^#{2,3}\s+(.+)/);
      if (headingMatch) {
        currentSection = headingMatch[1].trim();
        continue;
      }

      // Unchecked checkbox lines: - [ ] ...
      const checkboxMatch = trimmed.match(/^-\s+\[ \]\s+(.+)/);
      if (checkboxMatch) {
        checklist.push({
          text: checkboxMatch[1].trim(),
          section: currentSection,
        });
      }
    }
  } catch {
    // PRD unreadable -- skip
  }

  return checklist;
}

// ---------------------------------------------------------------------------
// Finding ID Generator
// ---------------------------------------------------------------------------

function generateFindingId(): string {
  return "f-" + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Keyword Extraction (for PRD criterion matching)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "has",
  "her",
  "was",
  "one",
  "our",
  "out",
  "its",
  "his",
  "how",
  "may",
  "who",
  "did",
  "get",
  "let",
  "say",
  "she",
  "too",
  "use",
  "way",
  "each",
  "which",
  "their",
  "will",
  "other",
  "about",
  "many",
  "then",
  "them",
  "been",
  "have",
  "from",
  "with",
  "they",
  "this",
  "that",
  "what",
  "when",
  "make",
  "like",
  "just",
  "over",
  "such",
  "take",
  "into",
  "than",
  "most",
  "also",
  "should",
  "would",
  "could",
  "must",
  "shall",
  "might",
  "does",
  "display",
  "show",
  "page",
  "user",
  "view",
  "click",
  "able",
  "ensure",
  "given",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Main: reviewWaveDiff
// ---------------------------------------------------------------------------

function reviewWaveDiff(options: ReviewWaveDiffOptions): Finding[] {
  const { projectDir, prdPath, baseBranch } = options;
  const findings: Finding[] = [];

  // 1. Get diff content
  const diffContent = getDiffContent(projectDir, baseBranch);
  if (!diffContent) return findings;

  // 2. Parse into hunks
  const hunks = parseDiffHunks(diffContent);
  if (hunks.length === 0) return findings;

  // 3. Extract PRD checklist
  const prdChecklist = extractPrdChecklist(prdPath, projectDir);

  // 4. For each PRD criterion, check if any hunk addresses it
  for (const criterion of prdChecklist) {
    const keywords = extractKeywords(criterion.text);
    if (keywords.length === 0) continue;

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

    if (!matched) {
      findings.push({
        id: generateFindingId(),
        severity: "error",
        message: `PRD criterion may not be addressed: "${criterion.text}"`,
        remediation: `Review PRD section "${criterion.section}" and ensure this criterion is covered by the current changes.`,
        source: `PRD: ${criterion.section}`,
      });
    }
  }

  // 5. Check added lines for common issues
  for (const hunk of hunks) {
    // Only check TypeScript/JavaScript files for code-level issues
    if (!/\.[tj]sx?$/.test(hunk.file)) continue;

    for (const addedLine of hunk.addedLines) {
      const text = addedLine.text;

      // console.log( -> warning
      if (/console\.log\(/.test(text)) {
        findings.push({
          id: generateFindingId(),
          severity: "warning",
          file: hunk.file,
          line: addedLine.line,
          message: "console.log() left in code -- consider removing debug output.",
          remediation:
            "Remove console.log statements before committing, or use a proper logger.",
          source: "Style: debug output",
        });
      }

      // : any type usage -> warning
      if (
        /:\s*any\b/.test(text) &&
        !text.includes("// eslint-disable") &&
        !text.includes("@ts-")
      ) {
        findings.push({
          id: generateFindingId(),
          severity: "warning",
          file: hunk.file,
          line: addedLine.line,
          message:
            "Explicit 'any' type used -- consider using a more specific type.",
          remediation:
            "Replace 'any' with a specific type or 'unknown' for type safety.",
          source: "Style: TypeScript strict mode",
        });
      }

      // TODO|FIXME|HACK -> warning
      if (/\b(TODO|FIXME|HACK)\b/.test(text)) {
        findings.push({
          id: generateFindingId(),
          severity: "warning",
          file: hunk.file,
          line: addedLine.line,
          message: "TODO/FIXME/HACK marker found in new code.",
          remediation:
            "Resolve the TODO or track it as a separate issue before merging.",
          source: "Style: code cleanliness",
        });
      }

      // Missing .js in relative imports -> error
      // Match from "./..." or from '../...' without .js extension
      if (/from\s+["'][.][^"']*(?<!\.js)["']/.test(text)) {
        findings.push({
          id: generateFindingId(),
          severity: "error",
          file: hunk.file,
          line: addedLine.line,
          message:
            "Relative import missing .js extension (ES module requirement).",
          remediation:
            "Add .js extension to all relative imports per ES module convention.",
          source: "Style: ES module imports",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { reviewWaveDiff };
export type { ReviewWaveDiffOptions };
