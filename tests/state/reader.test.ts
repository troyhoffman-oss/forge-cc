import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import {
  readStateFile,
  readRoadmapProgress,
  readCurrentMilestone,
  readSessionContext,
} from "../../src/state/reader.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const STATE_MD = `# forge-cc — Project State

## Current Position
- **Project:** forge-cc (build phase)
- **Milestone:** Milestone 2 — Linear Integration + Triage Skill
- **Branch:** feat/forge-build
- **Active PRD:** \`.planning/prds/forge-build.md\`
- **Last Session:** 2026-02-15

## Milestone Progress
| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Core CLI | Complete (2026-02-15) |
| 2 | Linear Integration | Pending |

## Next Actions
1. Execute Milestone 2
2. After all milestones: ship
`;

const ROADMAP_MD = `# Roadmap

| Milestone | Name | Status |
|-----------|------|--------|
| 1 | Core CLI | Complete (2026-02-15) |
| 2 | Linear Integration | Pending |
| 3 | Spec Skill | Pending |
`;

const PRD_MD = `## Implementation Milestones

### Milestone 1: Core CLI
**Goal:** Build the CLI

**Wave 1:**
1. **setup**: Init project

---

### Milestone 2: Linear Integration
**Goal:** Add Linear support

**Wave 1:**
1. **linear**: Build client

---

### Milestone 3: Spec Skill
**Goal:** Build spec
`;

const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readStateFile", () => {
  it("parses milestone number and name", async () => {
    mockReadFile.mockResolvedValue(STATE_MD);
    const result = await readStateFile("/proj");
    expect(result?.currentMilestone).toEqual({
      number: 2,
      name: "Linear Integration + Triage Skill",
    });
  });

  it("parses branch", async () => {
    mockReadFile.mockResolvedValue(STATE_MD);
    const result = await readStateFile("/proj");
    expect(result?.branch).toBe("feat/forge-build");
  });

  it("parses lastSession", async () => {
    mockReadFile.mockResolvedValue(STATE_MD);
    const result = await readStateFile("/proj");
    expect(result?.lastSession).toBe("2026-02-15");
  });

  it("parses nextActions from numbered list", async () => {
    mockReadFile.mockResolvedValue(STATE_MD);
    const result = await readStateFile("/proj");
    expect(result?.nextActions).toEqual([
      "Execute Milestone 2",
      "After all milestones: ship",
    ]);
  });

  it("returns null when file doesn't exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const result = await readStateFile("/proj");
    expect(result).toBeNull();
  });
});

describe("readRoadmapProgress", () => {
  it("parses milestone table correctly", async () => {
    mockReadFile.mockResolvedValue(ROADMAP_MD);
    const result = await readRoadmapProgress("/proj");
    expect(result?.milestones).toHaveLength(3);
    expect(result?.milestones[0]).toEqual({
      number: 1,
      name: "Core CLI",
      status: "Complete (2026-02-15)",
    });
    expect(result?.milestones[2]).toEqual({
      number: 3,
      name: "Spec Skill",
      status: "Pending",
    });
  });

  it("skips header and separator rows", async () => {
    mockReadFile.mockResolvedValue(ROADMAP_MD);
    const result = await readRoadmapProgress("/proj");
    const names = result?.milestones.map((m) => m.name) ?? [];
    expect(names).not.toContain("Name");
    expect(names).not.toContain("---");
  });
});

describe("readCurrentMilestone", () => {
  it("extracts correct milestone section", async () => {
    mockReadFile.mockResolvedValue(PRD_MD);
    const result = await readCurrentMilestone("/prd.md", 2);
    expect(result).toContain("### Milestone 2: Linear Integration");
    expect(result).toContain("**linear**: Build client");
    expect(result).not.toContain("Milestone 1");
    expect(result).not.toContain("Milestone 3");
  });

  it("returns null for missing milestone", async () => {
    mockReadFile.mockResolvedValue(PRD_MD);
    const result = await readCurrentMilestone("/prd.md", 99);
    expect(result).toBeNull();
  });
});

describe("readSessionContext", () => {
  it("combines all reads with token estimate", async () => {
    mockReadFile.mockImplementation(async (path: any) => {
      if (String(path).includes("STATE.md")) return STATE_MD;
      if (String(path).includes("ROADMAP.md")) return ROADMAP_MD;
      return PRD_MD;
    });
    const result = await readSessionContext("/proj", "/prd.md", 2);
    expect(result.state).not.toBeNull();
    expect(result.roadmap).not.toBeNull();
    expect(result.currentMilestoneSection).not.toBeNull();
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});
