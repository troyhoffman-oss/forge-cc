import { describe, it, expect } from "vitest";
import {
  globalClaudeMdTemplate,
  claudeMdTemplate,
  forgeConfigTemplate,
  stateMdTemplate,
  roadmapMdTemplate,
  lessonsMdTemplate,
  gitignoreForgeLines,
  type SetupContext,
} from "../../src/setup/templates.js";

const ctx: SetupContext = {
  projectName: "test-project",
  techStack: "TypeScript, Node.js",
  description: "A test project",
  gates: ["types", "lint", "tests"],
  date: "2026-02-15",
};

describe("globalClaudeMdTemplate", () => {
  const output = globalClaudeMdTemplate();

  it("has How to Work section", () => {
    expect(output).toContain("## How to Work");
  });

  it("has Verification section", () => {
    expect(output).toContain("## Verification");
  });

  it("has Principles section", () => {
    expect(output).toContain("## Principles");
  });

  it("does not contain 'forge'", () => {
    expect(output.toLowerCase()).not.toContain("forge");
  });

  it("does not contain 'Exception:'", () => {
    expect(output).not.toContain("Exception:");
  });

  it("does not contain session protocol", () => {
    expect(output).not.toContain("Session Protocol");
  });
});

describe("claudeMdTemplate", () => {
  const output = claudeMdTemplate(ctx);

  it("has Session Protocol with On start: line", () => {
    expect(output).toContain("## Session Protocol");
    expect(output).toContain("**On start:**");
  });

  it("has Session Protocol END", () => {
    expect(output).toContain("## Session Protocol END");
  });

  it("has Execution Rules", () => {
    expect(output).toContain("## Execution Rules");
  });

  it("does not have Delegate immediately", () => {
    expect(output).not.toContain("Delegate immediately");
  });

  it("does not have Critical Rules", () => {
    expect(output).not.toContain("Critical Rules");
  });
});

describe("forgeConfigTemplate", () => {
  const output = forgeConfigTemplate(ctx);

  it("produces valid JSON", () => {
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("has gates array", () => {
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed.gates)).toBe(true);
    expect(parsed.gates).toEqual(["types", "lint", "tests"]);
  });

  it("has maxIterations: 5", () => {
    const parsed = JSON.parse(output);
    expect(parsed.maxIterations).toBe(5);
  });
});

describe("stateMdTemplate", () => {
  const output = stateMdTemplate(ctx);

  it("has Current Status", () => {
    expect(output).toContain("## Current Status");
  });

  it("has What Was Done", () => {
    expect(output).toContain("## What Was Done");
  });

  it("has Next Actions", () => {
    expect(output).toContain("## Next Actions");
  });
});

describe("roadmapMdTemplate", () => {
  const output = roadmapMdTemplate(ctx);

  it("has markdown table with correct headers", () => {
    expect(output).toContain("| Project | Status | PRD | Milestones |");
  });
});

describe("lessonsMdTemplate", () => {
  const output = lessonsMdTemplate(ctx);

  it("has max-10 instruction comment", () => {
    expect(output).toContain("Max 10");
  });

  it("has (none yet) placeholder", () => {
    expect(output).toContain("(none yet)");
  });
});

describe("gitignoreForgeLines", () => {
  it("returns .forge/ line", () => {
    expect(gitignoreForgeLines()).toBe(".forge/\n");
  });
});
