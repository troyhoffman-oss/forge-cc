import { describe, it, expect } from "vitest";
import {
  createTeamConfig,
  buildTeamCreateParams,
  buildAgentSpawnConfig,
  buildShutdownMessage,
  buildMessage,
  buildBroadcast,
  getBuilderNames,
  shouldIncludeNotetaker,
} from "../../src/team/lifecycle.js";

// ---------------------------------------------------------------------------
// createTeamConfig
// ---------------------------------------------------------------------------

describe("createTeamConfig", () => {
  it("creates team name as m{N}-{slug}", () => {
    const config = createTeamConfig({
      prdSlug: "auth-flow",
      milestoneNumber: 3,
      builderCount: 2,
    });

    expect(config.teamName).toBe("m3-auth-flow");
    expect(config.prdSlug).toBe("auth-flow");
    expect(config.milestoneNumber).toBe(3);
  });

  it("includes executive, builders, and reviewer roles", () => {
    const config = createTeamConfig({
      prdSlug: "dashboard",
      milestoneNumber: 1,
      builderCount: 3,
    });

    expect(config.roles["executive"]).toBe("executive");
    expect(config.roles["builder-1"]).toBe("builder");
    expect(config.roles["builder-2"]).toBe("builder");
    expect(config.roles["builder-3"]).toBe("builder");
    expect(config.roles["reviewer"]).toBe("reviewer");
    // No notetaker by default
    expect(config.roles["notetaker"]).toBeUndefined();
  });

  it("includes notetaker role when includeNotetaker is true", () => {
    const config = createTeamConfig({
      prdSlug: "pipeline",
      milestoneNumber: 2,
      builderCount: 1,
      includeNotetaker: true,
    });

    expect(config.roles["notetaker"]).toBe("notetaker");
    expect(config.roles["executive"]).toBe("executive");
    expect(config.roles["builder-1"]).toBe("builder");
    expect(config.roles["reviewer"]).toBe("reviewer");
  });

  it("does not include notetaker when includeNotetaker is false", () => {
    const config = createTeamConfig({
      prdSlug: "pipeline",
      milestoneNumber: 2,
      builderCount: 2,
      includeNotetaker: false,
    });

    expect(config.roles["notetaker"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildTeamCreateParams
// ---------------------------------------------------------------------------

describe("buildTeamCreateParams", () => {
  it("returns correct team_name and description", () => {
    const config = createTeamConfig({
      prdSlug: "auth-flow",
      milestoneNumber: 2,
      builderCount: 2,
    });

    const params = buildTeamCreateParams(config);

    expect(params.team_name).toBe("m2-auth-flow");
    expect(params.description).toBe(
      "Milestone 2 execution for auth-flow",
    );
  });
});

// ---------------------------------------------------------------------------
// buildAgentSpawnConfig
// ---------------------------------------------------------------------------

describe("buildAgentSpawnConfig", () => {
  it("returns correct subagent_type, mode, and run_in_background", () => {
    const config = createTeamConfig({
      prdSlug: "test-slug",
      milestoneNumber: 1,
      builderCount: 2,
    });

    const spawn = buildAgentSpawnConfig(config, "builder-1", "Do the work");

    expect(spawn.team_name).toBe("m1-test-slug");
    expect(spawn.name).toBe("builder-1");
    expect(spawn.prompt).toBe("Do the work");
    expect(spawn.subagent_type).toBe("general-purpose");
    expect(spawn.mode).toBe("bypassPermissions");
    expect(spawn.run_in_background).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildShutdownMessage
// ---------------------------------------------------------------------------

describe("buildShutdownMessage", () => {
  it("returns correct type and recipient", () => {
    const msg = buildShutdownMessage("builder-2");

    expect(msg.type).toBe("shutdown_request");
    expect(msg.recipient).toBe("builder-2");
    expect(msg.content).toContain("builder-2");
  });
});

// ---------------------------------------------------------------------------
// buildMessage
// ---------------------------------------------------------------------------

describe("buildMessage", () => {
  it("returns correct type, recipient, content, and summary", () => {
    const msg = buildMessage("reviewer", "Please review wave 1", "Wave 1 review request");

    expect(msg.type).toBe("message");
    expect(msg.recipient).toBe("reviewer");
    expect(msg.content).toBe("Please review wave 1");
    expect(msg.summary).toBe("Wave 1 review request");
  });
});

// ---------------------------------------------------------------------------
// buildBroadcast
// ---------------------------------------------------------------------------

describe("buildBroadcast", () => {
  it("returns correct type, content, and summary", () => {
    const msg = buildBroadcast("All stop!", "Critical halt");

    expect(msg.type).toBe("broadcast");
    expect(msg.content).toBe("All stop!");
    expect(msg.summary).toBe("Critical halt");
  });
});

// ---------------------------------------------------------------------------
// getBuilderNames
// ---------------------------------------------------------------------------

describe("getBuilderNames", () => {
  it("returns only builder names", () => {
    const config = createTeamConfig({
      prdSlug: "test",
      milestoneNumber: 1,
      builderCount: 3,
      includeNotetaker: true,
    });

    const names = getBuilderNames(config);

    expect(names).toHaveLength(3);
    expect(names).toContain("builder-1");
    expect(names).toContain("builder-2");
    expect(names).toContain("builder-3");
    // Should not include non-builder roles
    expect(names).not.toContain("executive");
    expect(names).not.toContain("reviewer");
    expect(names).not.toContain("notetaker");
  });

  it("returns empty array when no builders exist", () => {
    const config = createTeamConfig({
      prdSlug: "test",
      milestoneNumber: 1,
      builderCount: 0,
    });

    const names = getBuilderNames(config);
    expect(names).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shouldIncludeNotetaker
// ---------------------------------------------------------------------------

describe("shouldIncludeNotetaker", () => {
  it("returns true when waveCount >= 3", () => {
    expect(shouldIncludeNotetaker(3, 2)).toBe(true);
    expect(shouldIncludeNotetaker(5, 1)).toBe(true);
  });

  it("returns true when maxAgentsPerWave >= 4", () => {
    expect(shouldIncludeNotetaker(1, 4)).toBe(true);
    expect(shouldIncludeNotetaker(2, 5)).toBe(true);
  });

  it("returns false when waveCount < 3 and maxAgentsPerWave < 4", () => {
    expect(shouldIncludeNotetaker(2, 3)).toBe(false);
    expect(shouldIncludeNotetaker(1, 1)).toBe(false);
  });
});
