import { z } from "zod";

export const devServerSchema = z.object({
  command: z.string(),
  port: z.number().int().positive(),
  readyPattern: z.string().optional(),
});

export const forgeConfigSchema = z.object({
  gates: z.array(z.string()).default(["types", "lint", "tests"]),
  maxIterations: z.number().int().positive().default(5),
  verifyFreshness: z.number().int().positive().default(600_000),
  devServer: devServerSchema.optional(),
  prdPath: z.string().optional(),
  linearProject: z.string().optional(),
});

export type ForgeConfigInput = z.input<typeof forgeConfigSchema>;
