import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import {
  claudeMdTemplate,
  forgeConfigTemplate,
  stateMdTemplate,
  roadmapMdTemplate,
  type SetupContext,
} from "../../src/setup/templates.js";
import { readStateFile, readRoadmapProgress } from "../../src/state/reader.js";
import { forgeConfigSchema } from "../../src/config/schema.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

const ctx: SetupContext = {
  projectName: "test-project",
  techStack: "TypeScript, Node.js",
  description: "A test project",
  gates: ["types", "lint", "tests"],
  date: "2026-02-15",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stateMdTemplate → readStateFile", () => {
  it("parses without error and returns a result", async () => {
    const templateOutput = stateMdTemplate(ctx);
    mockReadFile.mockResolvedValue(templateOutput);
    const result = await readStateFile("/fake");
    expect(result).not.toBeNull();
    expect(result?.raw).toBe(templateOutput);
  });
});

describe("roadmapMdTemplate → readRoadmapProgress", () => {
  it("parses without error and returns a result", async () => {
    const templateOutput = roadmapMdTemplate(ctx);
    mockReadFile.mockResolvedValue(templateOutput);
    const result = await readRoadmapProgress("/fake");
    expect(result).not.toBeNull();
    expect(result?.raw).toBe(templateOutput);
  });
});

describe("forgeConfigTemplate → forgeConfigSchema", () => {
  it("validates against forgeConfigSchema", () => {
    const templateOutput = forgeConfigTemplate(ctx);
    const parsed = JSON.parse(templateOutput);
    const result = forgeConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});

describe("claudeMdTemplate → forge:go compatibility", () => {
  const output = claudeMdTemplate(ctx);

  it("contains all sections that forge:go Step 1 reads", () => {
    expect(output).toContain("Session Protocol");
    expect(output).toContain("Execution Rules");
    expect(output).toContain("Learned Rules");
  });

  it("Session Protocol END has the 4 mandatory steps", () => {
    const endSection = output.slice(
      output.indexOf("## Session Protocol END"),
    );
    expect(endSection).toContain("1.");
    expect(endSection).toContain("2.");
    expect(endSection).toContain("3.");
    expect(endSection).toContain("4.");
    expect(endSection).toContain("STATE.md");
    expect(endSection).toContain("ROADMAP.md");
    expect(endSection).toContain("lessons.md");
    expect(endSection).toContain("Commit");
  });
});
