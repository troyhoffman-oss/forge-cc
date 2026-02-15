import type { GateError, GateResult } from "../types.js";
import {
  startDevServer,
  stopDevServer,
  waitForServer,
} from "../utils/browser.js";

export async function verifyRuntime(
  projectDir: string,
  endpoints: string[],
  options?: {
    devServerCommand?: string;
    devServerPort?: number;
  },
): Promise<GateResult> {
  const start = Date.now();
  const port = options?.devServerPort ?? 3000;
  const errors: GateError[] = [];
  const warnings: string[] = [];

  try {
    // Start dev server
    try {
      await startDevServer(projectDir, options?.devServerCommand, port);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown dev server error";
      return {
        gate: "runtime",
        passed: false,
        errors: [{ message: `Dev server failed to start: ${message}` }],
        warnings,
        duration_ms: Date.now() - start,
      };
    }

    // Ensure server is reachable
    const ready = await waitForServer(port);
    if (!ready) {
      return {
        gate: "runtime",
        passed: false,
        errors: [{ message: `Dev server not reachable on port ${port}` }],
        warnings,
        duration_ms: Date.now() - start,
      };
    }

    // Test each endpoint
    for (const endpoint of endpoints) {
      let method: string;
      let path: string;

      // Parse "GET /api/foo" or "POST /api/foo" or just "/api/foo"
      const spaceIndex = endpoint.indexOf(" ");
      if (spaceIndex !== -1 && spaceIndex < endpoint.indexOf("/")) {
        method = endpoint.substring(0, spaceIndex).toUpperCase();
        path = endpoint.substring(spaceIndex + 1).trim();
      } else {
        method = "GET";
        path = endpoint.trim();
      }

      const label = `${method} ${path}`;

      try {
        const response = await fetch(`http://localhost:${port}${path}`, {
          method,
        });

        if (response.status >= 200 && response.status < 300) {
          // Success -- try to parse as JSON for informational warning
          try {
            const json = await response.json();
            const keys = Object.keys(json);
            warnings.push(`${label} -> ${response.status} (JSON, ${keys.length} keys)`);
          } catch {
            // Not JSON -- still a success, just note it
            warnings.push(`${label} -> ${response.status} (non-JSON response)`);
          }
        } else {
          errors.push({
            message: `${label} -> ${response.status} ${response.statusText}`,
          });
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Request failed";
        errors.push({
          message: `${label} -> FAILED: ${message}`,
        });
      }
    }

    return {
      gate: "runtime",
      passed: errors.length === 0,
      errors,
      warnings,
      duration_ms: Date.now() - start,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error in verifyRuntime";
    return {
      gate: "runtime",
      passed: false,
      errors: [{ message }],
      warnings,
      duration_ms: Date.now() - start,
    };
  } finally {
    await stopDevServer();
  }
}
