import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { commitMilestoneWork } from "../../src/state/writer.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("commitMilestoneWork", () => {
  it("throws when filesToStage is empty", () => {
    expect(() =>
      commitMilestoneWork({
        projectDir: "/proj",
        milestoneNumber: 1,
        milestoneName: "Test",
        filesToStage: [],
      }),
    ).toThrow("filesToStage must contain at least one file");
  });

  it("stages files and commits with correct message", () => {
    mockExecSync.mockReturnValue("abc123\n" as any);
    const result = commitMilestoneWork({
      projectDir: "/proj",
      milestoneNumber: 2,
      milestoneName: "Linear Integration",
      filesToStage: ["src/foo.ts", "src/bar.ts"],
    });
    // git --version, symbolic-ref, add x2, commit, rev-parse = 6 calls
    expect(mockExecSync).toHaveBeenCalledTimes(6);
    expect(result.commitSha).toBe("abc123");
    expect(result.pushed).toBe(false);
  });
});
