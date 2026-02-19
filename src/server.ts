import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config/loader.js";
import {
  registerGate,
  runPipeline,
} from "./gates/index.js";
import { typesGate } from "./gates/types-gate.js";
import { lintGate } from "./gates/lint-gate.js";
import { testsGate } from "./gates/tests-gate.js";

/**
 * Create an MCP server instance with the forge_run_pipeline tool registered.
 * Exported for testing — call `startServer()` to run with stdio transport.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "forge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // Register default gates once at server creation (not per-call, to avoid race conditions)
  registerGate(typesGate);
  registerGate(lintGate);
  registerGate(testsGate);

  server.tool(
    "forge_run_pipeline",
    "Run the Forge verification pipeline (types, lint, tests)",
    {
      projectDir: z.string().optional().describe("Project directory (defaults to cwd)"),
      gates: z.array(z.string()).optional().describe("Filter to specific gates"),
    },
    async ({ projectDir, gates }) => {
      const dir = projectDir ?? process.cwd();
      const config = await loadConfig(dir);

      if (gates && gates.length > 0) {
        config.gates = gates;
      }

      const result = await runPipeline(config, dir);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

/** Start the MCP server on stdio transport. */
async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run when executed directly
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/server.js") || process.argv[1].endsWith("\\server.js"));

if (isMain) {
  startServer().catch((err) => {
    process.stderr.write(`Forge MCP server error: ${String(err)}\n`);
    process.exit(1);
  });
}
