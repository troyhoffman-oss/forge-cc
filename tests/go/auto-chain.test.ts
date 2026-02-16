import { describe, it, expect, vi, beforeEach } from "vitest";
import { countPendingMilestones, findNextPendingMilestone } from "../../src/go/auto-chain.js";

// Mock the state reader module
vi.mock("../../src/state/reader.js", () => ({
  readStateFile: vi.fn(),
  readRoadmapProgress: vi.fn(),
  readCurrentMilestone: vi.fn(),
}));

import { readRoadmapProgress } from "../../src/state/reader.js";
const mockReadRoadmap = vi.mocked(readRoadmapProgress);

describe("countPendingMilestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when no roadmap exists", async () => {
    mockReadRoadmap.mockResolvedValue(null);
    expect(await countPendingMilestones("/project")).toBe(0);
  });

  it("returns 0 when all milestones are complete", async () => {
    mockReadRoadmap.mockResolvedValue({
      milestones: [
        { number: 1, name: "First", status: "Complete (2026-02-10)" },
        { number: 2, name: "Second", status: "Done" },
      ],
      raw: "",
    });
    expect(await countPendingMilestones("/project")).toBe(0);
  });

  it("counts pending milestones correctly", async () => {
    mockReadRoadmap.mockResolvedValue({
      milestones: [
        { number: 1, name: "First", status: "Complete (2026-02-10)" },
        { number: 2, name: "Second", status: "Pending" },
        { number: 3, name: "Third", status: "Pending" },
      ],
      raw: "",
    });
    expect(await countPendingMilestones("/project")).toBe(2);
  });

  it("treats 'In Progress' as pending", async () => {
    mockReadRoadmap.mockResolvedValue({
      milestones: [
        { number: 1, name: "First", status: "In Progress" },
        { number: 2, name: "Second", status: "Pending" },
      ],
      raw: "",
    });
    expect(await countPendingMilestones("/project")).toBe(2);
  });
});

describe("findNextPendingMilestone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no roadmap exists", async () => {
    mockReadRoadmap.mockResolvedValue(null);
    expect(await findNextPendingMilestone("/project")).toBeNull();
  });

  it("returns null when all milestones are complete", async () => {
    mockReadRoadmap.mockResolvedValue({
      milestones: [
        { number: 1, name: "First", status: "Complete (2026-02-10)" },
        { number: 2, name: "Second", status: "Done" },
      ],
      raw: "",
    });
    expect(await findNextPendingMilestone("/project")).toBeNull();
  });

  it("returns the first pending milestone", async () => {
    mockReadRoadmap.mockResolvedValue({
      milestones: [
        { number: 1, name: "First", status: "Complete (2026-02-10)" },
        { number: 2, name: "Second", status: "Pending" },
        { number: 3, name: "Third", status: "Pending" },
      ],
      raw: "",
    });
    const result = await findNextPendingMilestone("/project");
    expect(result).toEqual({ number: 2, name: "Second", status: "Pending" });
  });

  it("returns lowest-numbered pending milestone regardless of order", async () => {
    mockReadRoadmap.mockResolvedValue({
      milestones: [
        { number: 3, name: "Third", status: "Pending" },
        { number: 1, name: "First", status: "Complete (2026-02-10)" },
        { number: 2, name: "Second", status: "In Progress" },
      ],
      raw: "",
    });
    const result = await findNextPendingMilestone("/project");
    expect(result).toEqual({ number: 2, name: "Second", status: "In Progress" });
  });

  it("returns null for empty milestones array", async () => {
    mockReadRoadmap.mockResolvedValue({ milestones: [], raw: "" });
    expect(await findNextPendingMilestone("/project")).toBeNull();
  });
});
