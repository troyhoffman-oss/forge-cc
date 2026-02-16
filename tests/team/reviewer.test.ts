import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewWaveDiff } from "../../src/team/reviewer.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "forge-reviewer-test-"));
  execSync("git init", { cwd: tmpDir });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir });
  execSync('git config user.name "Test"', { cwd: tmpDir });
  // Create initial commit
  await writeFile(join(tmpDir, "README.md"), "# Test\n", "utf-8");
  execSync("git add .", { cwd: tmpDir });
  execSync('git commit -m "initial"', { cwd: tmpDir });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("reviewWaveDiff", () => {
  it("returns empty array when no diff exists", () => {
    // No changes after initial commit -> no diff
    const findings = reviewWaveDiff({ projectDir: tmpDir });
    expect(findings).toEqual([]);
  });

  it("detects console.log() in added TypeScript lines", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "index.ts"),
      'console.log("debug");\n',
      "utf-8",
    );
    execSync("git add .", { cwd: tmpDir });
    execSync('git commit -m "add-ts-file"', { cwd: tmpDir });

    const findings = reviewWaveDiff({ projectDir: tmpDir });

    const consoleFinding = findings.find((f) =>
      f.message.toLowerCase().includes("console.log"),
    );
    expect(consoleFinding).toBeDefined();
    expect(consoleFinding!.severity).toBe("warning");
    expect(consoleFinding!.file).toBe("src/index.ts");
  });

  it("detects `: any` type usage in added lines", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "utils.ts"),
      "const x: any = 42;\n",
      "utf-8",
    );
    execSync("git add .", { cwd: tmpDir });
    execSync('git commit -m "add-any-type"', { cwd: tmpDir });

    const findings = reviewWaveDiff({ projectDir: tmpDir });

    const anyFinding = findings.find((f) =>
      f.message.toLowerCase().includes("any"),
    );
    expect(anyFinding).toBeDefined();
    expect(anyFinding!.severity).toBe("warning");
  });

  it("detects TODO markers in added lines", async () => {
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "work.ts"),
      "// TODO fix this later\nconst a = 1;\n",
      "utf-8",
    );
    execSync("git add .", { cwd: tmpDir });
    execSync('git commit -m "add-todo"', { cwd: tmpDir });

    const findings = reviewWaveDiff({ projectDir: tmpDir });

    const todoFinding = findings.find((f) =>
      f.message.toLowerCase().includes("todo"),
    );
    expect(todoFinding).toBeDefined();
    expect(todoFinding!.severity).toBe("warning");
  });

  it("returns empty array for non-TS/JS files containing console.log", async () => {
    await writeFile(
      join(tmpDir, "notes.md"),
      'Use console.log("hello") for debugging.\n',
      "utf-8",
    );
    execSync("git add .", { cwd: tmpDir });
    execSync('git commit -m "add-md-file"', { cwd: tmpDir });

    const findings = reviewWaveDiff({ projectDir: tmpDir });

    // .md files are not checked for code-level issues
    const consoleFinding = findings.find((f) =>
      f.message.toLowerCase().includes("console.log"),
    );
    expect(consoleFinding).toBeUndefined();
  });
});
