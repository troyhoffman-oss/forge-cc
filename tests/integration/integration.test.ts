import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Skill files reference only valid CLI commands
// ---------------------------------------------------------------------------

describe("Integration: skill files reference valid forge CLI commands", () => {
  // These are all the valid commands registered in src/cli.ts (or referenced as planned/documented)
  const validCommands = [
    "verify",
    "run",
    "status",
    "setup",
    "linear-sync",
    "linear",
    "doctor",
    "update",
    "codex-poll",
    "cleanup",
  ];

  // Also valid subcommands of linear-sync (deprecated, still referenced in skill files)
  const validLinearSubcommands = [
    "start",
    "complete",
    "done",
    "list-issues",
  ];

  // Valid subcommands of the new `forge linear` command group
  const validLinearNewSubcommands = [
    "sync-start",
    "sync-complete",
    "sync-done",
    "sync-planned",
    "list-issues",
    "create-project",
    "create-milestone",
    "create-issue",
    "create-issue-batch",
    "create-project-relation",
    "create-issue-relation",
    "list-teams",
    "list-projects",
  ];

  it("all skill files exist and are readable", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    expect(skillFiles.length).toBeGreaterThanOrEqual(4);

    const expectedSkills = [
      "forge-build.md",
      "forge-capture.md",
      "forge-fix.md",
      "forge-plan.md",
      "forge-quick.md",
      "forge-setup.md",
      "forge-update.md",
    ];

    for (const expected of expectedSkills) {
      expect(skillFiles).toContain(expected);
    }
  });

  it("npx forge commands in skill files reference only valid CLI commands", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    const invalidRefs: Array<{ file: string; line: number; command: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match patterns like "npx forge <command>" and "forge <command>"
        // but skip comments/prose that happen to mention "forge" in non-command contexts
        const npxMatches = line.matchAll(/npx\s+forge\s+([a-z][\w-]*)/g);
        for (const match of npxMatches) {
          const command = match[1];
          if (!validCommands.includes(command)) {
            invalidRefs.push({ file, line: i + 1, command });
          }
        }
      }
    }

    if (invalidRefs.length > 0) {
      const details = invalidRefs
        .map((r) => `  ${r.file}:${r.line} — "npx forge ${r.command}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidRefs.length} reference(s) to non-existent forge CLI commands:\n${details}\n\nValid commands: ${validCommands.join(", ")}`,
      );
    }
  });

  it("linear-sync subcommands in skill files are valid", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    const invalidSubs: Array<{ file: string; line: number; subcommand: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const subMatches = line.matchAll(/(?:npx\s+)?forge\s+linear-sync\s+([a-z][\w-]*)/g);
        for (const match of subMatches) {
          const sub = match[1];
          if (!validLinearSubcommands.includes(sub)) {
            invalidSubs.push({ file, line: i + 1, subcommand: sub });
          }
        }
      }
    }

    if (invalidSubs.length > 0) {
      const details = invalidSubs
        .map((r) => `  ${r.file}:${r.line} — "forge linear-sync ${r.subcommand}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidSubs.length} reference(s) to non-existent linear-sync subcommands:\n${details}\n\nValid subcommands: ${validLinearSubcommands.join(", ")}`,
      );
    }
  });

  it("linear subcommands in skill files are valid", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    const invalidSubs: Array<{ file: string; line: number; subcommand: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match `forge linear <sub>` but NOT `forge linear-sync <sub>` (handled by separate test)
        const subMatches = line.matchAll(/(?:npx\s+)?forge\s+linear\s+([a-z][\w-]*)/g);
        for (const match of subMatches) {
          const sub = match[1];
          if (!validLinearNewSubcommands.includes(sub)) {
            invalidSubs.push({ file, line: i + 1, subcommand: sub });
          }
        }
      }
    }

    if (invalidSubs.length > 0) {
      const details = invalidSubs
        .map((r) => `  ${r.file}:${r.line} — "forge linear ${r.subcommand}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidSubs.length} reference(s) to non-existent linear subcommands:\n${details}\n\nValid subcommands: ${validLinearNewSubcommands.join(", ")}`,
      );
    }
  });

  it("forge verify flag references in skills use valid --gate names", async () => {
    const skillDir = join(process.cwd(), "skills");
    const entries = await readdir(skillDir);
    const skillFiles = entries.filter((f) => f.startsWith("forge-") && f.endsWith(".md"));

    // Gates that are known to exist or be registered
    const knownGates = ["types", "lint", "tests", "visual", "runtime", "prd", "review", "codex"];

    const invalidGates: Array<{ file: string; line: number; gate: string }> = [];

    for (const file of skillFiles) {
      const content = await readFile(join(skillDir, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const gateMatch = line.match(/--gate\s+([a-z,]+)/);
        if (gateMatch) {
          const gates = gateMatch[1].split(",").map((g) => g.trim());
          for (const g of gates) {
            if (g && !knownGates.includes(g)) {
              invalidGates.push({ file, line: i + 1, gate: g });
            }
          }
        }
      }
    }

    if (invalidGates.length > 0) {
      const details = invalidGates
        .map((r) => `  ${r.file}:${r.line} — unknown gate "${r.gate}"`)
        .join("\n");
      expect.fail(
        `Found ${invalidGates.length} reference(s) to unknown gates:\n${details}\n\nKnown gates: ${knownGates.join(", ")}`,
      );
    }
  });
});
