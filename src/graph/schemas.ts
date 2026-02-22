import { z } from "zod";

export const requirementStatusEnum = z.enum([
  "pending",
  "in_progress",
  "complete",
  "discovered",
  "rejected",
]);

export const requirementFilesSchema = z.object({
  creates: z.array(z.string()).default([]),
  modifies: z.array(z.string()).default([]),
});

/** Validates YAML frontmatter of a requirement .md file. */
export const requirementFrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  files: requirementFilesSchema.default({ creates: [], modifies: [] }),
  acceptance: z.array(z.string()).min(1),
});

/** Validates a single requirement entry in _index.yaml. */
export const requirementMetaSchema = z.object({
  group: z.string().min(1),
  status: requirementStatusEnum,
  dependsOn: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  linearIssueId: z.string().optional(),
  completedAt: z.string().optional(),
  discoveredBy: z.string().optional(),
  rejectedReason: z.string().optional(),
});

/** Validates a group definition in _index.yaml. */
export const groupDefSchema = z.object({
  name: z.string().min(1),
  order: z.number().int().positive().optional(),
  dependsOn: z.array(z.string()).default([]),
  linearMilestoneId: z.string().optional(),
});

/** Validates the linear config block in _index.yaml. */
export const linearConfigSchema = z.object({
  projectId: z.string().min(1),
  teamId: z.string().min(1),
});

/** Validates the full _index.yaml structure. */
export const graphIndexSchema = z.object({
  project: z.string().min(1),
  slug: z.string().min(1),
  branch: z.string().min(1),
  createdAt: z.string().min(1),
  linear: linearConfigSchema.optional(),
  groups: z.record(z.string(), groupDefSchema),
  requirements: z.record(z.string(), requirementMetaSchema),
});
