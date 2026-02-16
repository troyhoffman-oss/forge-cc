import { describe, it, expect } from "vitest";
import {
  claudeMdTemplate,
  forgeConfigTemplate,
  type SetupContext,
} from "../../src/setup/templates.js";
import { forgeConfigSchema } from "../../src/config/schema.js";

const ctx: SetupContext = {
  projectName: "test-project",
  techStack: "TypeScript, Node.js",
  description: "A test project",
  gates: ["types", "lint", "tests"],
  date: "2026-02-15",
};

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
});
