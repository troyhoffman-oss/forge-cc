/**
 * Adaptive interview engine for spec generation.
 *
 * Pure logic — no side effects, no I/O. All state is passed in and returned.
 * The interview leads with recommendations derived from codebase scan results,
 * follows interesting threads based on user responses, and determines when
 * enough info has been gathered for each PRD section.
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

/** A single interview question */
export interface InterviewQuestion {
  id: string;
  section: PRDSection;
  text: string;
  /** Recommendation or observation that motivates the question */
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

/** Completeness status for a single section */
export interface SectionStatus {
  section: PRDSection;
  answeredCount: number;
  /** Minimum answers needed before the section is considered covered */
  minRequired: number;
  isComplete: boolean;
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
      isComplete: boolean;
    }
  >;
  scanResults: ScanAllResult;
}

// ---------------------------------------------------------------------------
// Minimum answer thresholds per section
// ---------------------------------------------------------------------------

const MIN_ANSWERS: Record<PRDSection, number> = {
  problem_and_goals: 2,
  user_stories: 2,
  technical_approach: 1,
  scope: 1,
  milestones: 1,
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
// Question Generation
// ---------------------------------------------------------------------------

/**
 * Generate 1-3 next questions based on current state.
 * Prioritizes sections with the most gaps, leads with recommendations.
 * Returns questions and the updated state (with new questions appended).
 */
export function generateNextQuestions(state: InterviewState): {
  questions: InterviewQuestion[];
  state: InterviewState;
} {
  const statuses = getSectionStatuses(state);
  const pendingFollowUp = findFollowUpOpportunities(state);

  const newQuestions: InterviewQuestion[] = [];
  let nextId = state.nextQuestionId;

  // Priority 1: Follow up on interesting threads (max 1 follow-up per batch)
  if (pendingFollowUp.length > 0 && newQuestions.length < 3) {
    const followUp = pendingFollowUp[0];
    newQuestions.push({
      id: `q${nextId++}`,
      section: followUp.section,
      text: followUp.text,
      context: followUp.context,
      depth: followUp.depth,
    });
  }

  // Priority 2: Ask about incomplete sections in priority order
  for (const section of PRD_SECTIONS) {
    if (newQuestions.length >= 3) break;

    const status = statuses.find((s) => s.section === section);
    if (status?.isComplete) continue;

    // Skip if we already have a question for this section in this batch
    if (newQuestions.some((q) => q.section === section)) continue;

    const question = generateSectionQuestion(state, section, nextId);
    if (question) {
      newQuestions.push(question);
      nextId++;
    }
  }

  // If we generated nothing (everything complete), return empty
  if (newQuestions.length === 0) {
    return { questions: [], state };
  }

  const updatedState: InterviewState = {
    ...state,
    questions: [...state.questions, ...newQuestions],
    nextQuestionId: nextId,
    askedSections: [
      ...new Set([
        ...state.askedSections,
        ...newQuestions.map((q) => q.section),
      ]),
    ],
  };

  return { questions: newQuestions, state: updatedState };
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
// Completeness Check
// ---------------------------------------------------------------------------

/**
 * Returns true when all sections have met their minimum answer thresholds.
 */
export function isComplete(state: InterviewState): boolean {
  return getSectionStatuses(state).every((s) => s.isComplete);
}

// ---------------------------------------------------------------------------
// Section Statuses
// ---------------------------------------------------------------------------

/**
 * Get the completeness status for all sections.
 */
export function getSectionStatuses(state: InterviewState): SectionStatus[] {
  return PRD_SECTIONS.map((section) => {
    const answeredCount = state.answers.filter(
      (a) => a.section === section,
    ).length;
    const minRequired = MIN_ANSWERS[section];
    return {
      section,
      answeredCount,
      minRequired,
      isComplete: answeredCount >= minRequired,
    };
  });
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
      isComplete: status.isComplete,
    };
  }

  return {
    projectName: state.projectName,
    sections,
    scanResults: state.scanResults,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a question for a specific section based on codebase context.
 * Returns null if no meaningful question can be generated.
 */
function generateSectionQuestion(
  state: InterviewState,
  section: PRDSection,
  nextId: number,
): InterviewQuestion | null {
  const answeredCount = state.answers.filter(
    (a) => a.section === section,
  ).length;
  const scan = state.scanResults;

  const q = (text: string, context: string): InterviewQuestion => ({
    id: `q${nextId}`,
    section,
    text,
    context,
    depth: 0,
  });

  switch (section) {
    case "problem_and_goals": {
      if (answeredCount === 0) {
        const fw = scan.structure.frameworks.length > 0 ? scan.structure.frameworks.join(", ") : null;
        return q(
          "What problem does this project solve? What's the desired outcome when it's done?",
          `I found a ${scan.structure.language} project${fw ? ` using ${fw}` : ""}. Help me understand what you're building and why.`,
        );
      }
      return q(
        "How will you know this project is successful? What does 'done' look like?",
        "I want to define clear success criteria for the PRD.",
      );
    }

    case "user_stories": {
      if (answeredCount === 0) {
        const pageRoutes = scan.routes.routes.filter((r) => r.type === "page");
        const apiRoutes = scan.routes.routes.filter((r) => r.type === "api");
        const hasRoutes = pageRoutes.length > 0;
        const hasAPI = apiRoutes.length > 0;
        const routeContext = hasRoutes
          ? `I see ${pageRoutes.length} page(s) and ${apiRoutes.length} API route(s).`
          : hasAPI
            ? `I see ${apiRoutes.length} API route(s) but no pages.`
            : "I don't see existing routes yet.";
        return q(
          "Who are the primary users of this feature? What do they need to accomplish?",
          `${routeContext} Understanding the users will help me structure milestones around their journeys.`,
        );
      }
      return q(
        "Are there secondary users or admin workflows to consider?",
        "Capturing all user types early prevents scope creep later.",
      );
    }

    case "technical_approach": {
      const fw = scan.structure.frameworks;
      const fwLabel = fw.length > 0 ? fw.join(", ") : null;
      const models = scan.dataAPIs.dataModels;
      const hasDB = models.length > 0;
      const dbLabel = hasDB
        ? models.slice(0, 3).map((m) => m.name).join(", ")
        : "";

      if (answeredCount === 0) {
        return q(
          "Are there specific technical decisions already made? Any constraints on architecture, APIs, or data storage?",
          `Current stack: ${scan.structure.language}${fwLabel ? `/${fwLabel}` : ""}${hasDB ? `, data models: [${dbLabel}]` : ""}. I'll build the technical approach around existing decisions.`,
        );
      }
      return null; // One answer usually sufficient for technical approach
    }

    case "scope": {
      const configFiles = scan.structure.configFiles;
      if (answeredCount === 0) {
        return q(
          "What's explicitly OUT of scope? Are there any sacred files or areas of the codebase that should not be touched?",
          configFiles.length > 0
            ? `Key config files I found: ${configFiles.slice(0, 8).join(", ")}. Knowing what's off-limits helps me write safer milestones.`
            : "Defining boundaries early prevents scope creep.",
        );
      }
      return null;
    }

    case "milestones": {
      if (answeredCount === 0) {
        return q(
          "How would you break this work into deliverable chunks? Any natural phases or dependencies between pieces?",
          "I'll structure Linear milestones around your phasing. Each milestone should be independently shippable.",
        );
      }
      return null;
    }
  }
}

/**
 * Find opportunities for follow-up questions based on recent answers.
 * Looks for keywords/patterns that suggest deeper exploration would be valuable.
 */
function findFollowUpOpportunities(
  state: InterviewState,
): Array<{
  section: PRDSection;
  text: string;
  context: string;
  depth: number;
}> {
  const opportunities: Array<{
    section: PRDSection;
    text: string;
    context: string;
    depth: number;
  }> = [];

  // Only consider the last 3 answers for follow-ups
  const recentAnswers = state.answers.slice(-3);

  for (const answer of recentAnswers) {
    const question = state.questions.find((q) => q.id === answer.questionId);
    if (!question) continue;

    // Don't follow up on follow-ups beyond depth 2
    if (question.depth >= 2) continue;

    // Don't generate follow-ups for questions we've already followed up on
    const hasFollowUp = state.questions.some(
      (q) =>
        q.depth > question.depth &&
        q.section === question.section &&
        state.questions.indexOf(q) > state.questions.indexOf(question),
    );
    if (hasFollowUp) continue;

    const lower = answer.answer.toLowerCase();

    // Detect mentions of migration/breaking changes — worth digging into
    if (
      (lower.includes("migrat") || lower.includes("breaking")) &&
      question.section !== "scope"
    ) {
      opportunities.push({
        section: "scope",
        text: "You mentioned migration/breaking changes. What existing data or APIs need to be preserved? Any backward compatibility requirements?",
        context: `Based on your answer about ${SECTION_LABELS[question.section]}.`,
        depth: question.depth + 1,
      });
    }

    // Detect mentions of multiple user types — worth expanding user stories
    if (
      (lower.includes("admin") ||
        lower.includes("different user") ||
        lower.includes("roles")) &&
      answer.section === "user_stories"
    ) {
      opportunities.push({
        section: "user_stories",
        text: "You mentioned different user types/roles. Can you walk me through the key workflow for each type?",
        context: "Multiple user types often need separate milestone planning.",
        depth: question.depth + 1,
      });
    }

    // Detect mentions of external services — worth clarifying integration scope
    if (
      (lower.includes("api") ||
        lower.includes("third-party") ||
        lower.includes("external") ||
        lower.includes("integration")) &&
      answer.section === "technical_approach"
    ) {
      opportunities.push({
        section: "technical_approach",
        text: "You mentioned external integrations. Which services are critical path vs nice-to-have? Any rate limits or auth concerns?",
        context: "External dependencies often need their own milestone.",
        depth: question.depth + 1,
      });
    }
  }

  return opportunities;
}
