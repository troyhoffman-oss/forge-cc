#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  verifyTypes,
  verifyLint,
  verifyTests,
  verifyVisual,
  verifyRuntime,
  verifyPrd,
  runPipeline,
} from "./gates/index.js";

const server = new McpServer({
  name: "forge-cc",
  version: "0.1.0",
});

// Individual gate tools
// Each handler is wrapped in try-catch to return structured errors instead of crashing the MCP server.

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
}

server.tool(
  "forge_verify_types",
  "Run TypeScript type checking (tsc --noEmit)",
  { projectDir: z.string().describe("Absolute path to project root") },
  async ({ projectDir }) => {
    try {
      const result = await verifyTypes(projectDir);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return errorResponse(err); }
  },
);

server.tool(
  "forge_verify_lint",
  "Run Biome linting checks",
  { projectDir: z.string().describe("Absolute path to project root") },
  async ({ projectDir }) => {
    try {
      const result = await verifyLint(projectDir);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return errorResponse(err); }
  },
);

server.tool(
  "forge_verify_tests",
  "Run project test suite",
  { projectDir: z.string().describe("Absolute path to project root") },
  async ({ projectDir }) => {
    try {
      const result = await verifyTests(projectDir);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return errorResponse(err); }
  },
);

server.tool(
  "forge_verify_visual",
  "Take screenshots and check for console errors",
  {
    projectDir: z.string().describe("Absolute path to project root"),
    pages: z.array(z.string()).default(["/"]).describe("Page paths to check"),
    devServerCommand: z.string().optional().describe("Dev server start command"),
    devServerPort: z.number().optional().describe("Dev server port"),
  },
  async ({ projectDir, pages, devServerCommand, devServerPort }) => {
    try {
      const result = await verifyVisual(projectDir, pages, { devServerCommand, devServerPort });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return errorResponse(err); }
  },
);

server.tool(
  "forge_verify_runtime",
  "Validate API endpoints return expected responses",
  {
    projectDir: z.string().describe("Absolute path to project root"),
    endpoints: z.array(z.string()).describe("API endpoints to test (e.g., 'GET /api/health')"),
    devServerCommand: z.string().optional().describe("Dev server start command"),
    devServerPort: z.number().optional().describe("Dev server port"),
  },
  async ({ projectDir, endpoints, devServerCommand, devServerPort }) => {
    try {
      const result = await verifyRuntime(projectDir, endpoints, { devServerCommand, devServerPort });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return errorResponse(err); }
  },
);

server.tool(
  "forge_verify_prd",
  "Check code changes against PRD acceptance criteria",
  {
    projectDir: z.string().describe("Absolute path to project root"),
    prdPath: z.string().describe("Path to PRD markdown file"),
    baseBranch: z.string().default("main").describe("Base branch for diff comparison"),
  },
  async ({ projectDir, prdPath, baseBranch }) => {
    try {
      const result = await verifyPrd(projectDir, prdPath, baseBranch);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return errorResponse(err); }
  },
);

server.tool(
  "forge_run_pipeline",
  "Run full verification pipeline (all configured gates)",
  {
    projectDir: z.string().describe("Absolute path to project root"),
    gates: z.array(z.string()).optional().describe("Gates to run (default: types,lint,tests)"),
    prdPath: z.string().optional().describe("Path to PRD file"),
    maxIterations: z.number().optional().describe("Max retry iterations"),
  },
  async ({ projectDir, gates, prdPath, maxIterations }) => {
    try {
      const result = await runPipeline({
        projectDir,
        gates,
        prdPath,
        maxIterations,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) { return errorResponse(err); }
  },
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
