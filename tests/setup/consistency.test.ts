import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  globalClaudeMdTemplate,
  claudeMdTemplate,
  type SetupContext,
} from "../../src/setup/templates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

const ctx: SetupContext = {
  projectName: "test-project",
  techStack: "TypeScript, Node.js",
  description: "A test project",
  gates: ["types", "lint", "tests"],
  date: "2026-02-15",
};

describe("actual CLAUDE.md consistency", () => {
  let actualClaudeMd: string;

  // Read the real committed file (not mocked)
  beforeAll(async () => {
    actualClaudeMd = await readFile(
      resolve(projectRoot, "CLAUDE.md"),
      "utf-8",
    );
  });

  it("has Session Protocol section with On start: line", () => {
    expect(actualClaudeMd).toContain("## Session Protocol");
    expect(actualClaudeMd).toContain("**On start:**");
  });

  it("has Session Protocol END section", () => {
    expect(actualClaudeMd).toContain("## Session Protocol END");
  });

  it("does NOT have Delegate immediately", () => {
    expect(actualClaudeMd).not.toContain("Delegate immediately");
  });

  it("does NOT have Critical Rules", () => {
    expect(actualClaudeMd).not.toContain("Critical Rules");
  });
});

describe("template size and duplication", () => {
  it("globalClaudeMdTemplate output is ~15 lines (±3)", () => {
    const output = globalClaudeMdTemplate();
    const lines = output.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(12);
    expect(lines).toBeLessThanOrEqual(18);
  });

  it("claudeMdTemplate does NOT duplicate rules from globalClaudeMdTemplate", () => {
    const projectOutput = claudeMdTemplate(ctx);
    expect(projectOutput).not.toContain("Use agent teams");
  });
});
