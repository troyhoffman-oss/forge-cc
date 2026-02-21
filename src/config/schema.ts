import { z } from "zod";

export const forgeConfigSchema = z.object({
  gates: z.array(z.string()).default(["types", "lint", "tests"]),
  gateTimeouts: z.record(z.string(), z.number()).default({}),
  maxIterations: z.number().default(5),
  linearTeam: z.string().default(""),
  verifyFreshness: z.number().default(600000),
  forgeVersion: z.string().default("1.0.0"),
}).strict();

export type ForgeConfigSchema = z.infer<typeof forgeConfigSchema>;
