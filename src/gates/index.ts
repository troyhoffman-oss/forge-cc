import type { ForgeConfig, GateResult, PipelineResult } from "../types.js";

/** A single verification gate. */
export interface Gate {
  name: string;
  run: (projectDir: string) => Promise<GateResult>;
}

const registry = new Map<string, Gate>();

/** Register a gate in the global registry. */
export function registerGate(gate: Gate): void {
  registry.set(gate.name, gate);
}

/** List all registered gate names in insertion order. */
export function listGates(): string[] {
  return [...registry.keys()];
}

/** Clear all registered gates (for testing). */
export function clearGates(): void {
  registry.clear();
}

/** Run the verification pipeline: execute configured gates sequentially with per-gate timeouts. */
export async function runPipeline(
  config: ForgeConfig,
  projectDir: string,
): Promise<PipelineResult> {
  const start = Date.now();
  const results: GateResult[] = [];
  const defaultTimeout = 120_000;

  for (const gateName of config.gates) {
    const gate = registry.get(gateName);
    if (!gate) {
      results.push({
        gate: gateName,
        passed: false,
        errors: [{ file: "", line: 0, message: `Gate "${gateName}" not registered` }],
        durationMs: 0,
      });
      continue;
    }

    const timeout = config.gateTimeouts[gateName] ?? defaultTimeout;
    const gateStart = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        gate.run(projectDir),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Gate "${gateName}" timed out after ${timeout}ms`)), timeout);
        }),
      ]);
      results.push(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        gate: gateName,
        passed: false,
        errors: [{ file: "", line: 0, message }],
        durationMs: Date.now() - gateStart,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  const allPassed = results.every((r) => r.passed);
  return {
    result: allPassed ? "PASSED" : "FAILED",
    gates: results,
    durationMs: Date.now() - start,
  };
}
