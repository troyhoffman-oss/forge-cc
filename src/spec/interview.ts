/**
 * Interview state tracker and coverage analyzer for spec generation.
 *
 * Pure logic — no side effects, no I/O. All state is passed in and returned.
 * The LLM (via the /forge:spec skill) drives question generation using scan
 * results, prior answers, and coverage analysis. This module tracks state,
 * analyzes coverage gaps, and provides structured summaries for PRD generation.
 *
 * **Rendering contract:** {@link InterviewQuestion} objects are designed to be
 * rendered via Claude Code's **AskUserQuestion** tool with structured
 * multiple-choice options — they must NEVER be printed as numbered text in
 * chat. The caller (the /forge:spec skill) is responsible for converting each
 * question's `text` and `context` fields into an AskUserQuestion call with
 * 2-4 predefined options derived from scan context, plus an "Other" escape
 * hatch for free-text input.
 */

import type { ScanAllResult } from "./scanner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** PRD sections in priority order */
export const PRD_SECTIONS = [
  "problem_and_goals",
  "user_stories",
  "technical_approach",
  "scope",
  "milestones",
] as const;
export type PRDSection = (typeof PRD_SECTIONS)[number];

/** Human-readable labels for each section */
export const SECTION_LABELS: Record<PRDSection, string> = {
  problem_and_goals: "Problem & Goals",
  user_stories: "User Stories",
  technical_approach: "Technical Approach",
  scope: "Scope",
  milestones: "Milestones",
};

/**
 * A single interview question.
 *
 * **Rendering:** Must be presented to the user via Claude Code's
 * AskUserQuestion tool with 2-4 multiple-choice options — NEVER as numbered
 * text in chat output. The `text` field becomes the AskUserQuestion question
 * string, and the `context` field provides scan-derived framing that informs
 * option generation.
 */
export interface InterviewQuestion {
  id: string;
  section: PRDSection;
  /** The question to present via AskUserQuestion */
  text: string;
  /** Recommendation or observation from the codebase scan that motivates
   *  this question and informs the multiple-choice options */
  context: string;
  /** Follow-up depth — 0 = top-level, 1+ = follow-up */
  depth: number;
}

/** A recorded answer to a question */
export interface InterviewAnswer {
  questionId: string;
  section: PRDSection;
  answer: string;
  timestamp: number;
}

/** Coverage level for a section */
export type CoverageLevel = "none" | "thin" | "moderate" | "thorough";

/** Completeness status for a single section */
export interface SectionStatus {
  section: PRDSection;
  answeredCount: number;
  totalWords: number;
  coverageLevel: CoverageLevel;
  hasGaps: boolean;
}

/** Full interview state — serializable, passed in/out of every function */
export interface InterviewState {
  projectName: string;
  scanResults: ScanAllResult;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  /** Counter used to generate unique question IDs */
  nextQuestionId: number;
  /** Tracks which sections the engine has asked top-level questions for */
  askedSections: PRDSection[];
  /** Number of answers recorded since the last PRD draft update */
  answersSinceLastDraft: number;
}

/** Structured summary of gathered info for PRD generation */
export interface InterviewSummary {
  projectName: string;
  sections: Record<
    PRDSection,
    {
      label: string;
      answers: Array<{ question: string; answer: string }>;
      coverageLevel: CoverageLevel;
    }
  >;
  scanResults: ScanAllResult;
}

/** Per-section coverage detail */
export interface SectionCoverage {
  section: PRDSection;
  label: string;
  answeredCount: number;
  totalWords: number;
  coverageLevel: CoverageLevel;
  /** All subtopics for this section */
  topics: string[];
  /** Topics that appear in answers (simple substring match) */
  mentionedTopics: string[];
  /** topics − mentionedTopics */
  uncoveredTopics: string[];
}

/** Full coverage analysis across all sections */
export interface CoverageAnalysis {
  sections: SectionCoverage[];
  overallLevel: CoverageLevel;
  hasGaps: boolean;
}

// ---------------------------------------------------------------------------
// Section Topics — subtopic checklists the LLM uses for coverage analysis
// ---------------------------------------------------------------------------

export const SECTION_TOPICS: Record<PRDSection, string[]> = {
  problem_and_goals: [
    "core problem",
    "desired outcome",
    "success criteria",
    "impact/urgency",
    "current workarounds",
    "who feels the pain",
  ],
  user_stories: [
    "primary users",
    "user workflows step-by-step",
    "secondary users",
    "edge cases",
    "permissions/roles",
    "error states",
  ],
  technical_approach: [
    "architecture pattern",
    "data model/schema",
    "APIs/integrations",
    "auth/security",
    "performance requirements",
    "error handling",
    "existing code to leverage",
  ],
  scope: [
    "in scope boundaries",
    "out of scope",
    "sacred files/areas",
    "constraints",
    "future phases explicitly deferred",
  ],
  milestones: [
    "breakdown into chunks",
    "dependencies between milestones",
    "sizing (fits in one agent context?)",
    "verification criteria",
    "delivery order",
    "risk areas",
  ],
};

// ---------------------------------------------------------------------------
// Interview Creation
// ---------------------------------------------------------------------------

/**
 * Initialize a new interview with codebase context.
 * The scan results inform the recommendations attached to questions.
 */
export function createInterview(
  projectName: string,
  scanResults: ScanAllResult,
): InterviewState {
  return {
    projectName,
    scanResults,
    questions: [],
    answers: [],
    nextQuestionId: 1,
    askedSections: [],
    answersSinceLastDraft: 0,
  };
}

// ---------------------------------------------------------------------------
// Question Registration (LLM registers questions it asks for tracking)
// ---------------------------------------------------------------------------

/**
 * Register a question the LLM asked, for summary/tracking purposes.
 * The LLM drives question generation — this just records what was asked.
 */
export function addQuestion(
  state: InterviewState,
  section: PRDSection,
  text: string,
  context: string,
  depth: number = 0,
): InterviewState {
  const question: InterviewQuestion = {
    id: `q${state.nextQuestionId}`,
    section,
    text,
    context,
    depth,
  };

  return {
    ...state,
    questions: [...state.questions, question],
    nextQuestionId: state.nextQuestionId + 1,
    askedSections: [
      ...new Set([...state.askedSections, section]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Answer Recording
// ---------------------------------------------------------------------------

/**
 * Record the user's answer and return updated state.
 */
export function recordAnswer(
  state: InterviewState,
  questionId: string,
  answer: string,
): InterviewState {
  const question = state.questions.find((q) => q.id === questionId);
  if (!question) {
    throw new Error(`Question not found: ${questionId}`);
  }

  const newAnswer: InterviewAnswer = {
    questionId,
    section: question.section,
    answer,
    timestamp: Date.now(),
  };

  return {
    ...state,
    answers: [...state.answers, newAnswer],
    answersSinceLastDraft: state.answersSinceLastDraft + 1,
  };
}

// ---------------------------------------------------------------------------
// Draft Update Check
// ---------------------------------------------------------------------------

/**
 * Returns true every 2-3 answers (triggers at 2, then every 3).
 * The caller is responsible for resetting the counter after updating the draft.
 */
export function shouldUpdateDraft(state: InterviewState): boolean {
  return state.answersSinceLastDraft >= 2;
}

/**
 * Reset the draft update counter (call after updating the PRD draft).
 */
export function markDraftUpdated(state: InterviewState): InterviewState {
  return {
    ...state,
    answersSinceLastDraft: 0,
  };
}

// ---------------------------------------------------------------------------
// Section Statuses
// ---------------------------------------------------------------------------

/**
 * Compute the coverage level for a section based on answer count, word count,
 * and topic coverage.
 */
function computeCoverageLevel(
  answeredCount: number,
  totalWords: number,
  topics: string[],
  mentionedTopics: string[],
): CoverageLevel {
  if (answeredCount === 0) return "none";
  if (answeredCount === 1 || totalWords < 50) return "thin";

  const mostTopicsMentioned =
    topics.length === 0 || mentionedTopics.length >= topics.length * 0.6;

  if (answeredCount >= 4 || (totalWords >= 200 && mostTopicsMentioned)) {
    return "thorough";
  }
  if (answeredCount >= 2 && totalWords >= 50) return "moderate";
  return "thin";
}

/**
 * Find which SECTION_TOPICS appear in the section's answers (simple substring match).
 */
function findMentionedTopics(
  answers: string[],
  topics: string[],
): string[] {
  const combined = answers.join(" ").toLowerCase();
  return topics.filter((topic) => combined.includes(topic.toLowerCase()));
}

/**
 * Get the completeness status for all sections.
 */
export function getSectionStatuses(state: InterviewState): SectionStatus[] {
  return PRD_SECTIONS.map((section) => {
    const sectionAnswers = state.answers.filter((a) => a.section === section);
    const answeredCount = sectionAnswers.length;
    const totalWords = sectionAnswers.reduce(
      (sum, a) => sum + a.answer.split(/\s+/).filter(Boolean).length,
      0,
    );
    const topics = SECTION_TOPICS[section];
    const mentionedTopics = findMentionedTopics(
      sectionAnswers.map((a) => a.answer),
      topics,
    );
    const uncoveredTopics = topics.filter((t) => !mentionedTopics.includes(t));
    const coverageLevel = computeCoverageLevel(
      answeredCount,
      totalWords,
      topics,
      mentionedTopics,
    );

    return {
      section,
      answeredCount,
      totalWords,
      coverageLevel,
      hasGaps: uncoveredTopics.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Coverage Analysis
// ---------------------------------------------------------------------------

/**
 * Get detailed coverage analysis for all sections, including topic-level detail.
 * This is the primary tool for the LLM to decide what to ask next.
 */
export function getCoverageAnalysis(state: InterviewState): CoverageAnalysis {
  const sections: SectionCoverage[] = PRD_SECTIONS.map((section) => {
    const sectionAnswers = state.answers.filter((a) => a.section === section);
    const answeredCount = sectionAnswers.length;
    const totalWords = sectionAnswers.reduce(
      (sum, a) => sum + a.answer.split(/\s+/).filter(Boolean).length,
      0,
    );
    const topics = SECTION_TOPICS[section];
    const mentionedTopics = findMentionedTopics(
      sectionAnswers.map((a) => a.answer),
      topics,
    );
    const uncoveredTopics = topics.filter((t) => !mentionedTopics.includes(t));
    const coverageLevel = computeCoverageLevel(
      answeredCount,
      totalWords,
      topics,
      mentionedTopics,
    );

    return {
      section,
      label: SECTION_LABELS[section],
      answeredCount,
      totalWords,
      coverageLevel,
      topics,
      mentionedTopics,
      uncoveredTopics,
    };
  });

  const levels: CoverageLevel[] = sections.map((s) => s.coverageLevel);
  const hasGaps = sections.some((s) => s.uncoveredTopics.length > 0);

  let overallLevel: CoverageLevel;
  if (levels.every((l) => l === "thorough")) {
    overallLevel = "thorough";
  } else if (levels.every((l) => l === "thorough" || l === "moderate")) {
    overallLevel = "moderate";
  } else if (levels.some((l) => l !== "none")) {
    overallLevel = "thin";
  } else {
    overallLevel = "none";
  }

  return { sections, overallLevel, hasGaps };
}

// ---------------------------------------------------------------------------
// Interview Summary
// ---------------------------------------------------------------------------

/**
 * Build a structured summary of everything gathered, for PRD generation.
 */
export function getInterviewSummary(state: InterviewState): InterviewSummary {
  const statuses = getSectionStatuses(state);

  const sections = {} as InterviewSummary["sections"];
  for (const section of PRD_SECTIONS) {
    const sectionAnswers = state.answers.filter((a) => a.section === section);
    const status = statuses.find((s) => s.section === section)!;

    sections[section] = {
      label: SECTION_LABELS[section],
      answers: sectionAnswers.map((a) => {
        const question = state.questions.find((q) => q.id === a.questionId);
        return {
          question: question?.text ?? "(unknown question)",
          answer: a.answer,
        };
      }),
      coverageLevel: status.coverageLevel,
    };
  }

  return {
    projectName: state.projectName,
    sections,
    scanResults: state.scanResults,
  };
}

