import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import {
  readCurrentMilestone,
  readSessionContext,
} from "../../src/state/reader.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

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
  it("returns slug and milestone section with token estimate", async () => {
    mockReadFile.mockResolvedValue(PRD_MD);
    const result = await readSessionContext("/proj", "/prd.md", 2, "test-slug");
    expect(result.prdSlug).toBe("test-slug");
    expect(result.currentMilestoneSection).not.toBeNull();
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});
