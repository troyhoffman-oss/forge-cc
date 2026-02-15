import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────

export const UserStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
});

export const MilestoneWaveSchema = z.object({
  waveNumber: z.number(),
  agents: z.array(
    z.object({
      name: z.string(),
      task: z.string(),
      files: z.array(z.string()),
    })
  ),
});

export const MilestoneSchema = z.object({
  number: z.number(),
  name: z.string(),
  goal: z.string(),
  assignedTo: z.string(),
  waves: z.array(MilestoneWaveSchema),
  verificationCommands: z.array(z.string()),
});

export const PRDSchema = z.object({
  project: z.string(),
  status: z.string(),
  branch: z.string(),
  created: z.string(),
  assignedTo: z.string(),
  linearProject: z.string().optional(),
  overview: z.string(),
  problemStatement: z.string(),
  scope: z.object({
    inScope: z.array(z.string()),
    outOfScope: z.array(z.string()),
    sacred: z.array(z.string()),
  }),
  userStories: z.array(UserStorySchema),
  technicalDesign: z.object({
    projectStructure: z.string().optional(),
    keyTypes: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
    existingCode: z.string().optional(),
  }),
  milestones: z.array(MilestoneSchema),
  verification: z.object({
    perMilestone: z.array(z.string()),
    overall: z.array(z.string()),
  }),
});

// ── Inferred Types ───────────────────────────────────────────────────

export type UserStory = z.infer<typeof UserStorySchema>;
export type MilestoneWave = z.infer<typeof MilestoneWaveSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type PRDData = z.infer<typeof PRDSchema>;

// ── Helper Functions ─────────────────────────────────────────────────

/**
 * Validates raw data against the PRD schema.
 * Throws a ZodError if validation fails.
 */
export function validatePRD(data: unknown): PRDData {
  return PRDSchema.parse(data);
}

/**
 * Creates an empty PRD scaffold with sensible defaults.
 */
export function createEmptyPRD(projectName: string): PRDData {
  return {
    project: projectName,
    status: "Draft",
    branch: "",
    created: new Date().toISOString().split("T")[0],
    assignedTo: "",
    overview: "",
    problemStatement: "",
    scope: {
      inScope: [],
      outOfScope: [],
      sacred: [],
    },
    userStories: [],
    technicalDesign: {},
    milestones: [],
    verification: {
      perMilestone: [],
      overall: [],
    },
  };
}
