import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  writeStateFile,
  updateRoadmapMilestone,
  writeSessionMemory,
} from "../../src/state/writer.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

const stateInput = {
  project: "forge-cc",
  milestone: { number: 2, name: "Linear Integration" },
  branch: "feat/forge-build",
  activePrd: ".planning/prds/forge-build.md",
  lastSession: "2026-02-15",
  milestoneTable: [
    { number: 1, name: "Core CLI", status: "Complete (2026-02-15)" },
    { number: 2, name: "Linear Integration", status: "In Progress" },
  ],
  nextActions: ["Finish wave 1", "Run tests"],
};

describe("writeStateFile", () => {
  it("writes correct markdown content", async () => {
    await writeStateFile("/proj", stateInput);
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("# forge-cc — Project State");
    expect(written).toContain("**Milestone:** Milestone 2 — Linear Integration");
    expect(written).toContain("**Branch:** feat/forge-build");
    expect(written).toContain("1. Finish wave 1");
    expect(written).toContain("2. Run tests");
    expect(written).toContain("| 1 | Core CLI | Complete (2026-02-15) |");
  });

  it("creates directory before writing", async () => {
    await writeStateFile("/proj", stateInput);
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining(".planning"),
      { recursive: true },
    );
    expect(mockMkdir.mock.invocationCallOrder[0]).toBeLessThan(
      mockWriteFile.mock.invocationCallOrder[0],
    );
  });
});

describe("updateRoadmapMilestone", () => {
  const roadmap = `# Roadmap

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Core CLI | Pending |
| 2 | Linear Integration | Pending |
`;

  it("updates correct row in table", async () => {
    mockReadFile.mockResolvedValue(roadmap);
    await updateRoadmapMilestone("/proj", 1, "Complete (2026-02-15)");
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("| 1 | Core CLI | Complete (2026-02-15) |");
    expect(written).toContain("| 2 | Linear Integration | Pending |");
  });

  it("throws on missing milestone", async () => {
    mockReadFile.mockResolvedValue(roadmap);
    await expect(
      updateRoadmapMilestone("/proj", 99, "Complete"),
    ).rejects.toThrow("Milestone 99 not found");
  });
});

describe("writeSessionMemory", () => {
  const memoryInput = {
    date: "2026-02-15",
    developer: "claude",
    workingOn: "Milestone 2",
    status: "in-progress",
    next: "Finish wave 2",
    blockers: "none",
  };

  it("writes correct content", async () => {
    await writeSessionMemory("/proj", "feat/forge-build", memoryInput);
    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("# Session State");
    expect(written).toContain("**Developer:** claude");
    expect(written).toContain("**Working On:** Milestone 2");
  });

  it("uses branch slug in filename", async () => {
    await writeSessionMemory("/proj", "feat/Forge-Build", memoryInput);
    const filePath = mockWriteFile.mock.calls[0][0] as string;
    expect(filePath).toContain("session-feat-forge-build.md");
    expect(filePath).not.toContain("/");
  });
});
