import { describe, it, expect } from "vitest";
import {
  createInterview,
  addQuestion,
  recordAnswer,
  shouldUpdateDraft,
  markDraftUpdated,
  getSectionStatuses,
  getCoverageAnalysis,
  getInterviewSummary,
  SECTION_TOPICS,
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

describe("addQuestion", () => {
  it("registers a question and updates state", () => {
    const state = createInterview("test-project", mockScanResults);
    const updated = addQuestion(
      state,
      "problem_and_goals",
      "What problem does this solve?",
      "Found a TypeScript project",
    );

    expect(updated.questions).toHaveLength(1);
    expect(updated.questions[0].id).toBe("q1");
    expect(updated.questions[0].section).toBe("problem_and_goals");
    expect(updated.questions[0].text).toBe("What problem does this solve?");
    expect(updated.questions[0].context).toBe("Found a TypeScript project");
    expect(updated.questions[0].depth).toBe(0);
    expect(updated.nextQuestionId).toBe(2);
    expect(updated.askedSections).toContain("problem_and_goals");
  });

  it("increments question IDs", () => {
    let state = createInterview("test-project", mockScanResults);
    state = addQuestion(state, "problem_and_goals", "Q1", "C1");
    state = addQuestion(state, "user_stories", "Q2", "C2");
    state = addQuestion(state, "technical_approach", "Q3", "C3");

    expect(state.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(state.nextQuestionId).toBe(4);
  });

  it("tracks asked sections without duplicates", () => {
    let state = createInterview("test-project", mockScanResults);
    state = addQuestion(state, "problem_and_goals", "Q1", "C1");
    state = addQuestion(state, "problem_and_goals", "Q2", "C2");

    expect(state.askedSections).toEqual(["problem_and_goals"]);
  });

  it("respects custom depth", () => {
    const state = createInterview("test-project", mockScanResults);
    const updated = addQuestion(state, "scope", "Follow-up?", "Context", 2);

    expect(updated.questions[0].depth).toBe(2);
  });
});

describe("recordAnswer", () => {
  it("adds answer and increments draft counter", () => {
    let state = createInterview("test-project", mockScanResults);
    state = addQuestion(state, "problem_and_goals", "Q1", "C1");

    const updated = recordAnswer(state, "q1", "My answer");

    expect(updated.answers).toHaveLength(1);
    expect(updated.answers[0].answer).toBe("My answer");
    expect(updated.answers[0].questionId).toBe("q1");
    expect(updated.answers[0].section).toBe("problem_and_goals");
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

describe("getSectionStatuses", () => {
  it("returns coverage-based status for all sections", () => {
    const state = createInterview("test-project", mockScanResults);
    const statuses = getSectionStatuses(state);

    expect(statuses).toHaveLength(PRD_SECTIONS.length);
    const problemStatus = statuses.find((s) => s.section === "problem_and_goals");
    expect(problemStatus).toBeDefined();
    expect(problemStatus!.answeredCount).toBe(0);
    expect(problemStatus!.totalWords).toBe(0);
    expect(problemStatus!.coverageLevel).toBe("none");
    expect(problemStatus!.hasGaps).toBe(true);
  });

  it("returns thin coverage for 1 short answer", () => {
    let state = createInterview("test-project", mockScanResults);
    state = addQuestion(state, "problem_and_goals", "Q1", "C1");
    state = recordAnswer(state, "q1", "Short answer");
    const statuses = getSectionStatuses(state);

    const status = statuses.find((s) => s.section === "problem_and_goals")!;
    expect(status.answeredCount).toBe(1);
    expect(status.coverageLevel).toBe("thin");
  });

  it("returns moderate coverage for 2 answers with 50+ words", () => {
    let state = createInterview("test-project", mockScanResults);
    state = addQuestion(state, "problem_and_goals", "Q1", "C1");
    state = recordAnswer(state, "q1", "This is a detailed answer about the core problem we are solving with this project and it includes quite a few words to get past the fifty word threshold needed for moderate coverage in the analysis function which we need to test properly");
    state = addQuestion(state, "problem_and_goals", "Q2", "C2");
    state = recordAnswer(state, "q2", "Another detailed answer explaining the desired outcome and success criteria for the project including all the important details that make this answer sufficiently long to contribute meaningfully to word count");
    const statuses = getSectionStatuses(state);

    const status = statuses.find((s) => s.section === "problem_and_goals")!;
    expect(status.answeredCount).toBe(2);
    expect(status.coverageLevel).toBe("moderate");
  });

  it("returns thorough for 4+ answers", () => {
    let state = createInterview("test-project", mockScanResults);
    for (let i = 0; i < 4; i++) {
      state = addQuestion(state, "problem_and_goals", `Q${i + 1}`, `C${i + 1}`);
      state = recordAnswer(state, `q${i + 1}`, `Answer ${i + 1} with enough words to count towards the word threshold for thorough coverage level in the analysis`);
    }
    const statuses = getSectionStatuses(state);

    const status = statuses.find((s) => s.section === "problem_and_goals")!;
    expect(status.coverageLevel).toBe("thorough");
  });
});

describe("getCoverageAnalysis", () => {
  it("returns none overall for empty state", () => {
    const state = createInterview("test-project", mockScanResults);
    const analysis = getCoverageAnalysis(state);

    expect(analysis.overallLevel).toBe("none");
    expect(analysis.hasGaps).toBe(true);
    expect(analysis.sections).toHaveLength(PRD_SECTIONS.length);
    for (const s of analysis.sections) {
      expect(s.coverageLevel).toBe("none");
      expect(s.answeredCount).toBe(0);
      expect(s.topics).toEqual(SECTION_TOPICS[s.section]);
      expect(s.mentionedTopics).toEqual([]);
      expect(s.uncoveredTopics).toEqual(SECTION_TOPICS[s.section]);
    }
  });

  it("detects mentioned topics via substring match", () => {
    let state = createInterview("test-project", mockScanResults);
    state = addQuestion(state, "problem_and_goals", "Q1", "C1");
    state = recordAnswer(
      state,
      "q1",
      "The core problem is that users have no current workarounds for the pain they feel",
    );

    const analysis = getCoverageAnalysis(state);
    const section = analysis.sections.find((s) => s.section === "problem_and_goals")!;

    expect(section.mentionedTopics).toContain("core problem");
    expect(section.mentionedTopics).toContain("current workarounds");
    expect(section.uncoveredTopics).not.toContain("core problem");
    expect(section.uncoveredTopics).not.toContain("current workarounds");
    // Topics not mentioned should be uncovered
    expect(section.uncoveredTopics).toContain("success criteria");
  });

  it("computes hasGaps correctly", () => {
    let state = createInterview("test-project", mockScanResults);

    // Add thorough answers to problem_and_goals covering all topics
    const allTopics = SECTION_TOPICS.problem_and_goals.join(", ");
    for (let i = 0; i < 4; i++) {
      state = addQuestion(state, "problem_and_goals", `Q${i + 1}`, `C${i + 1}`);
      state = recordAnswer(state, `q${i + 1}`, `Covering ${allTopics} in detail`);
    }

    const analysis = getCoverageAnalysis(state);
    // Still has gaps because other sections have no answers
    expect(analysis.hasGaps).toBe(true);
    // But problem_and_goals section itself should have no gaps
    const problemSection = analysis.sections.find((s) => s.section === "problem_and_goals")!;
    expect(problemSection.uncoveredTopics).toEqual([]);
  });

  it("overall moderate when all sections at least moderate", () => {
    let state = createInterview("test-project", mockScanResults);
    let qIdx = 1;

    for (const section of PRD_SECTIONS) {
      // Add 2 answers with 50+ words total for moderate coverage
      for (let i = 0; i < 2; i++) {
        state = addQuestion(state, section, `Q${qIdx}`, `C${qIdx}`);
        state = recordAnswer(
          state,
          `q${qIdx}`,
          "This is a detailed answer that contains enough words to pass the fifty word threshold for moderate coverage level in the analysis function and we add more words here to ensure it is over the limit for sure this time around absolutely positively definitely",
        );
        qIdx++;
      }
    }

    const analysis = getCoverageAnalysis(state);
    expect(analysis.overallLevel).toBe("moderate");
  });

  it("overall thorough when all sections thorough", () => {
    let state = createInterview("test-project", mockScanResults);
    let qIdx = 1;

    for (const section of PRD_SECTIONS) {
      const allTopics = SECTION_TOPICS[section].join(", ");
      for (let i = 0; i < 4; i++) {
        state = addQuestion(state, section, `Q${qIdx}`, `C${qIdx}`);
        state = recordAnswer(state, `q${qIdx}`, `Covering ${allTopics} in great detail`);
        qIdx++;
      }
    }

    const analysis = getCoverageAnalysis(state);
    expect(analysis.overallLevel).toBe("thorough");
  });

  it("provides section labels", () => {
    const state = createInterview("test-project", mockScanResults);
    const analysis = getCoverageAnalysis(state);

    expect(analysis.sections[0].label).toBe("Problem & Goals");
    expect(analysis.sections[1].label).toBe("User Stories");
    expect(analysis.sections[2].label).toBe("Technical Approach");
    expect(analysis.sections[3].label).toBe("Scope");
    expect(analysis.sections[4].label).toBe("Milestones");
  });
});

describe("getInterviewSummary", () => {
  it("returns structured summary with coverageLevel", () => {
    let state = createInterview("test-project", mockScanResults);
    state = addQuestion(state, "problem_and_goals", "What problem?", "Scan context");
    state = recordAnswer(state, "q1", "Test answer");

    const summary = getInterviewSummary(state);

    expect(summary.projectName).toBe("test-project");
    expect(summary.scanResults).toBe(mockScanResults);
    // Should have entries for all sections
    for (const section of PRD_SECTIONS) {
      expect(summary.sections[section]).toBeDefined();
      expect(summary.sections[section].label).toBeTruthy();
      expect(summary.sections[section].coverageLevel).toBeDefined();
    }
    // The section we answered should have data
    expect(summary.sections.problem_and_goals.answers).toHaveLength(1);
    expect(summary.sections.problem_and_goals.answers[0].answer).toBe("Test answer");
    expect(summary.sections.problem_and_goals.answers[0].question).toBe("What problem?");
    expect(summary.sections.problem_and_goals.coverageLevel).toBe("thin");
  });
});
