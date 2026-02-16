import type { AgentRole, TeamConfig } from "./types.js";

// ---------------------------------------------------------------------------
// createTeamConfig — builds a TeamConfig for a milestone execution
// ---------------------------------------------------------------------------
export function createTeamConfig(options: {
  prdSlug: string;
  milestoneNumber: number;
  builderCount: number;
  includeNotetaker?: boolean;
}): TeamConfig {
  const { prdSlug, milestoneNumber, builderCount, includeNotetaker } = options;

  const roles: Record<string, AgentRole> = {
    executive: "executive",
  };

  for (let i = 1; i <= builderCount; i++) {
    roles[`builder-${i}`] = "builder";
  }

  roles["reviewer"] = "reviewer";

  if (includeNotetaker) {
    roles["notetaker"] = "notetaker";
  }

  return {
    teamName: `m${milestoneNumber}-${prdSlug}`,
    prdSlug,
    milestoneNumber,
    roles,
  };
}

// ---------------------------------------------------------------------------
// buildTeamCreateParams — returns params the skill passes to TeamCreate
// ---------------------------------------------------------------------------
export function buildTeamCreateParams(config: TeamConfig): {
  team_name: string;
  description: string;
} {
  return {
    team_name: config.teamName,
    description: `Milestone ${config.milestoneNumber} execution for ${config.prdSlug}`,
  };
}

// ---------------------------------------------------------------------------
// buildAgentSpawnConfig — returns config for spawning an agent via Task tool
// ---------------------------------------------------------------------------
export function buildAgentSpawnConfig(
  config: TeamConfig,
  agentName: string,
  prompt: string,
): {
  team_name: string;
  name: string;
  prompt: string;
  subagent_type: string;
  mode: string;
  run_in_background: boolean;
} {
  // Look up role to validate agent name exists in config
  const _role = config.roles[agentName];

  return {
    team_name: config.teamName,
    name: agentName,
    prompt,
    subagent_type: "general-purpose",
    mode: "bypassPermissions",
    run_in_background: true,
  };
}

// ---------------------------------------------------------------------------
// buildShutdownMessage — returns SendMessage params for shutdown request
// ---------------------------------------------------------------------------
export function buildShutdownMessage(agentName: string): {
  type: "shutdown_request";
  recipient: string;
  content: string;
} {
  return {
    type: "shutdown_request",
    recipient: agentName,
    content: `Task complete, shutting down ${agentName}`,
  };
}

// ---------------------------------------------------------------------------
// buildMessage — returns SendMessage params for a direct message
// ---------------------------------------------------------------------------
export function buildMessage(
  recipient: string,
  content: string,
  summary: string,
): {
  type: "message";
  recipient: string;
  content: string;
  summary: string;
} {
  return {
    type: "message",
    recipient,
    content,
    summary,
  };
}

// ---------------------------------------------------------------------------
// buildBroadcast — returns SendMessage params for broadcast
// ---------------------------------------------------------------------------
export function buildBroadcast(
  content: string,
  summary: string,
): {
  type: "broadcast";
  content: string;
  summary: string;
} {
  return {
    type: "broadcast",
    content,
    summary,
  };
}

// ---------------------------------------------------------------------------
// getBuilderNames — returns array of builder agent names from config
// ---------------------------------------------------------------------------
export function getBuilderNames(config: TeamConfig): string[] {
  return Object.entries(config.roles)
    .filter(([, role]) => role === "builder")
    .map(([name]) => name);
}

// ---------------------------------------------------------------------------
// shouldIncludeNotetaker — decision logic per PRD
// ---------------------------------------------------------------------------
export function shouldIncludeNotetaker(
  waveCount: number,
  maxAgentsPerWave: number,
): boolean {
  return waveCount >= 3 || maxAgentsPerWave >= 4;
}
