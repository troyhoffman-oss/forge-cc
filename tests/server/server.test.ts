import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PipelineResult } from "../../src/types.js";
import { createServer } from "../../src/server.js";

describe("MCP server", () => {
  it("lists the forge_run_pipeline tool", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("forge_run_pipeline");
    expect(tools[0].description).toBeTruthy();

    await client.close();
    await server.close();
  });

  it("returns structured gate results from forge_run_pipeline", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Call with gates that the server registers (types, lint, tests)
    // but use a non-existent dir so gates will fail fast with errors
    const result = await client.callTool({
      name: "forge_run_pipeline",
      arguments: {
        projectDir: process.cwd(),
        gates: ["types"],
      },
    });

    // Result should have content with pipeline result JSON
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content.length).toBeGreaterThan(0);
    expect(content[0].type).toBe("text");

    const pipeline = JSON.parse(content[0].text) as PipelineResult;
    expect(pipeline).toHaveProperty("result");
    expect(pipeline).toHaveProperty("gates");
    expect(pipeline).toHaveProperty("durationMs");
    expect(Array.isArray(pipeline.gates)).toBe(true);
    expect(pipeline.gates.length).toBeGreaterThan(0);
    expect(pipeline.gates[0].gate).toBe("types");

    await client.close();
    await server.close();
  }, 60000);

  it("defaults to cwd when projectDir is not provided", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Call without projectDir — should default to cwd
    const result = await client.callTool({
      name: "forge_run_pipeline",
      arguments: {
        gates: ["types"],
      },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const pipeline = JSON.parse(content[0].text) as PipelineResult;
    expect(pipeline).toHaveProperty("result");
    expect(pipeline.gates[0].gate).toBe("types");

    await client.close();
    await server.close();
  }, 60000);
});
