import { describe, it, expect, beforeEach } from "vitest";
import {
  createInterview,
  generateNextQuestions,
  recordAnswer,
  shouldUpdateDraft,
  markDraftUpdated,
  isComplete,
  getSectionStatuses,
  getInterviewSummary,
  PRD_SECTIONS,
} from "../../src/spec/interview.js";
import type { ScanAllResult } from "../../src/spec/scanner.js";

const mockScanResults: ScanAllResult = {
  structure: {
    projectName: "test-project",
    frameworks: ["Next.js"],
    language: "typescript",
    packageManager: "npm",
    configFiles: ["tsconfig.json", "next.config.js"],
    topLevelDirs: ["src", "public"],
    entryPoints: ["src/app/page.tsx"],
  },
  routes: {
    framework: "Next.js (App Router)",
    routeDir: "src/app",
    routes: [
      { path: "/", file: "src/app/page.tsx", type: "page" },
      { path: "/api/hello", file: "src/app/api/hello/route.ts", type: "api" },
    ],
    components: ["src/components/Button.tsx"],
  },
  dataAPIs: {
    apiEndpoints: [{ method: "GET", path: "/api/hello", file: "src/app/api/hello/route.ts" }],
    dataModels: [],
    externalServices: [],
    databaseType: null,
  },
};

describe("createInterview", () => {
  it("initializes state correctly", () => {
    const state = createInterview("test-project", mockScanResults);

    expect(state.projectName).toBe("test-project");
    expect(state.scanResults).toBe(mockScanResults);
    expect(state.questions).toEqual([]);
    expect(state.answers).toEqual([]);
    expect(state.nextQuestionId).toBe(1);
    expect(state.askedSections).toEqual([]);
    expect(state.answersSinceLastDraft).toBe(0);
  });
});

describe("generateNextQuestions", () => {
  it("returns questions prioritized by section gaps", () => {
    const state = createInterview("test-project", mockScanResults);
    const { questions, state: newState } = generateNextQuestions(state);

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(3);
    // First question should target problem_and_goals (highest priority section)
    expect(questions[0].section).toBe("problem_and_goals");
    expect(newState.questions.length).toBe(questions.length);
    expect(newState.nextQuestionId).toBeGreaterThan(state.nextQuestionId);
  });

  it("returns empty when all sections are complete", () => {
    let state = createInterview("test-project", mockScanResults);
    // Answer enough for every section
    for (const section of PRD_SECTIONS) {
      const minRequired = section === "problem_and_goals" || section === "user_stories" ? 2 : 1;
      for (let i = 0; i < minRequired; i++) {
        const { state: s } = generateNextQuestions(state);
        state = s;
        const q = state.questions.find(
          (q) => q.section === section && !state.answers.some((a) => a.questionId === q.id),
        );
        if (q) state = recordAnswer(state, q.id, `Answer for ${section} #${i}`);
      }
    }

    const { questions } = generateNextQuestions(state);
    expect(questions).toEqual([]);
  });
});

describe("recordAnswer", () => {
  it("adds answer and increments draft counter", () => {
    let state = createInterview("test-project", mockScanResults);
    const { state: s } = generateNextQuestions(state);
    state = s;
    const qId = state.questions[0].id;

    const updated = recordAnswer(state, qId, "My answer");

    expect(updated.answers).toHaveLength(1);
    expect(updated.answers[0].answer).toBe("My answer");
    expect(updated.answers[0].questionId).toBe(qId);
    expect(updated.answersSinceLastDraft).toBe(1);
  });

  it("throws on unknown question ID", () => {
    const state = createInterview("test-project", mockScanResults);
    expect(() => recordAnswer(state, "nonexistent", "answer")).toThrow("Question not found");
  });
});

describe("shouldUpdateDraft", () => {
  it("returns false with 0-1 answers since last draft", () => {
    const state = createInterview("test-project", mockScanResults);
    expect(shouldUpdateDraft(state)).toBe(false);
    expect(shouldUpdateDraft({ ...state, answersSinceLastDraft: 1 })).toBe(false);
  });

  it("triggers at 2+ answers", () => {
    const state = createInterview("test-project", mockScanResults);
    expect(shouldUpdateDraft({ ...state, answersSinceLastDraft: 2 })).toBe(true);
    expect(shouldUpdateDraft({ ...state, answersSinceLastDraft: 5 })).toBe(true);
  });
});

describe("markDraftUpdated", () => {
  it("resets counter to 0", () => {
    const state = createInterview("test-project", mockScanResults);
    const withAnswers = { ...state, answersSinceLastDraft: 3 };
    const result = markDraftUpdated(withAnswers);
    expect(result.answersSinceLastDraft).toBe(0);
  });
});

describe("isComplete", () => {
  it("returns false initially", () => {
    const state = createInterview("test-project", mockScanResults);
    expect(isComplete(state)).toBe(false);
  });
});

describe("getSectionStatuses", () => {
  it("shows per-section status with correct minimums", () => {
    const state = createInterview("test-project", mockScanResults);
    const statuses = getSectionStatuses(state);

    expect(statuses).toHaveLength(PRD_SECTIONS.length);
    const problemStatus = statuses.find((s) => s.section === "problem_and_goals");
    expect(problemStatus).toBeDefined();
    expect(problemStatus!.minRequired).toBe(2);
    expect(problemStatus!.answeredCount).toBe(0);
    expect(problemStatus!.isComplete).toBe(false);
  });
});

describe("getInterviewSummary", () => {
  it("returns structured summary", () => {
    let state = createInterview("test-project", mockScanResults);
    const { state: s } = generateNextQuestions(state);
    state = s;
    state = recordAnswer(state, state.questions[0].id, "Test answer");

    const summary = getInterviewSummary(state);

    expect(summary.projectName).toBe("test-project");
    expect(summary.scanResults).toBe(mockScanResults);
    // Should have entries for all sections
    for (const section of PRD_SECTIONS) {
      expect(summary.sections[section]).toBeDefined();
      expect(summary.sections[section].label).toBeTruthy();
    }
    // The section we answered should have data
    const answeredSection = state.questions[0].section;
    expect(summary.sections[answeredSection].answers).toHaveLength(1);
    expect(summary.sections[answeredSection].answers[0].answer).toBe("Test answer");
  });
});
