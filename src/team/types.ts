import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent Role
// ---------------------------------------------------------------------------
export const AgentRoleSchema = z.enum([
  "executive",
  "builder",
  "reviewer",
  "notetaker",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

// ---------------------------------------------------------------------------
// Team Config
// ---------------------------------------------------------------------------
export const TeamConfigSchema = z.object({
  teamName: z.string(),
  prdSlug: z.string(),
  milestoneNumber: z.number(),
  roles: z.record(z.string(), AgentRoleSchema),
});
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------
export const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["error", "warning"]),
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string(),
  remediation: z.string(),
  source: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

// ---------------------------------------------------------------------------
// Consensus Round
// ---------------------------------------------------------------------------
export const ConsensusRoundSchema = z.object({
  findingId: z.string(),
  round: z.number(),
  builderName: z.string(),
  response: z.enum(["agree", "disagree", "alternative"]),
  reason: z.string().optional(),
  alternativeProposal: z.string().optional(),
});
export type ConsensusRound = z.infer<typeof ConsensusRoundSchema>;

// ---------------------------------------------------------------------------
// Consensus Result
// ---------------------------------------------------------------------------
export const ConsensusResultSchema = z.object({
  findingId: z.string(),
  resolution: z.enum(["accepted", "rejected", "escalated"]),
  rounds: z.array(ConsensusRoundSchema),
  finalDecision: z.string().optional(),
});
export type ConsensusResult = z.infer<typeof ConsensusResultSchema>;

// ---------------------------------------------------------------------------
// Team Review Result
// ---------------------------------------------------------------------------
export const TeamReviewResultSchema = z.object({
  findings: z.array(FindingSchema),
  consensusResults: z.array(ConsensusResultSchema),
  duration_ms: z.number(),
});
export type TeamReviewResult = z.infer<typeof TeamReviewResultSchema>;

// ---------------------------------------------------------------------------
// Codex Comment
// ---------------------------------------------------------------------------
export const CodexCommentSchema = z.object({
  id: z.number(),
  body: z.string(),
  path: z.string(),
  line: z.number().optional(),
  resolved: z.boolean(),
});
export type CodexComment = z.infer<typeof CodexCommentSchema>;
