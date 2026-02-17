import { z } from "zod";

export const devServerSchema = z.object({
  command: z.string(),
  port: z.number().int().positive(),
  readyPattern: z.string().optional(),
});

export const reviewConfigSchema = z.object({
  blocking: z.boolean().default(false),
});

export const testingConfigSchema = z.object({
  enforce: z.boolean().default(true),
  runner: z.enum(["vitest", "jest", "none"]).default("vitest"),
  testDir: z.string().default("tests"),
  sourceDir: z.string().default("src"),
  structural: z.boolean().default(true),
  categories: z.array(z.string()).default([]),
});

export const forgeConfigSchema = z.object({
  appDir: z.string().optional(),
  gates: z.array(z.string()).default(["types", "lint", "tests"]),
  maxIterations: z.number().int().positive().default(5),
  verifyFreshness: z.number().int().positive().default(600_000),
  devServer: devServerSchema.optional(),
  prdPath: z.string().optional(),
  linearProject: z.string().optional(),
  review: reviewConfigSchema.optional(),
  testing: testingConfigSchema.optional(),
  /** forge-cc version used during last /forge:setup */
  forgeVersion: z.string().optional(),
});

export type ForgeConfigInput = z.input<typeof forgeConfigSchema>;
