// ── Test Templates ──────────────────────────────────────────────────
// Framework-aware unit test template generators.
// Each function takes a source file path and returns a complete test file string.

import { basename, dirname, extname, relative, sep } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a PascalCase or camelCase module name from a file path.
 * e.g. "src/utils/parse-config.ts" -> "parseConfig"
 */
function extractModuleName(sourcePath: string): string {
  const base = basename(sourcePath);
  const name = base.replace(/\.(ts|tsx|js|jsx)$/, "");
  // Convert kebab-case to camelCase
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Compute the relative import path from a test file to its source file.
 * Assumes test files live in __tests__/ adjacent to source, or co-located.
 * Returns a path with no extension (for TS imports).
 */
export function computeRelativeImport(
  testFilePath: string,
  sourceFilePath: string,
): string {
  const testDir = dirname(testFilePath);
  let rel = relative(testDir, sourceFilePath).replace(/\\/g, "/");
  // Strip the file extension for TypeScript imports
  rel = rel.replace(/\.(ts|tsx|js|jsx)$/, "");
  // Ensure it starts with ./
  if (!rel.startsWith(".")) {
    rel = "./" + rel;
  }
  return rel;
}

/**
 * Derive a default test file path from a source path (co-located pattern).
 * e.g. "src/utils/helpers.ts" -> "src/utils/helpers.test.ts"
 */
function deriveTestPath(sourcePath: string): string {
  const dir = dirname(sourcePath);
  const base = basename(sourcePath);
  const ext = extname(base);
  const nameWithoutExt = base.replace(/\.(ts|tsx|js|jsx)$/, "");
  const testExt = ext === ".tsx" || ext === ".jsx" ? ext : ".ts";
  return `${dir}${sep}${nameWithoutExt}.test${testExt}`.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Test stub for Next.js App Router API route handlers.
 * Tests GET/POST/PUT/DELETE handler functions with mocked NextRequest/NextResponse.
 */
export function nextjsApiRouteTemplate(sourcePath: string): string {
  const moduleName = extractModuleName(sourcePath);
  const testPath = deriveTestPath(sourcePath);
  const importPath = computeRelativeImport(testPath, sourcePath);

  return `import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// TODO: Update imports to match the actual exports from the source module
import { GET, POST } from "${importPath}.js";

describe("${moduleName} API route", () => {
  describe("GET handler", () => {
    it("should return a successful response", async () => {
      const request = new NextRequest("http://localhost:3000/api/${moduleName}");

      const response = await GET(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toBeDefined();
    });

    it("should handle errors gracefully", async () => {
      const request = new NextRequest("http://localhost:3000/api/${moduleName}");

      // TODO: Mock a dependency to trigger an error
      const response = await GET(request);

      expect(response.status).toBeDefined();
    });
  });

  describe("POST handler", () => {
    it("should accept valid input and return success", async () => {
      const request = new NextRequest("http://localhost:3000/api/${moduleName}", {
        method: "POST",
        body: JSON.stringify({ /* TODO: add valid request body */ }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it("should reject invalid input", async () => {
      const request = new NextRequest("http://localhost:3000/api/${moduleName}", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);

      // TODO: Assert the expected error status code
      expect(response.status).toBeDefined();
    });
  });
});
`;
}

/**
 * Test stub for React components using React Testing Library patterns.
 * Includes render test and basic interaction test.
 */
export function reactComponentTemplate(sourcePath: string): string {
  const moduleName = extractModuleName(sourcePath);
  // Capitalize first letter for component name convention
  const componentName =
    moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
  const testPath = deriveTestPath(sourcePath);
  const importPath = computeRelativeImport(testPath, sourcePath);

  return `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// TODO: Update import to match the actual default/named export
import { ${componentName} } from "${importPath}.js";

describe("${componentName} component", () => {
  it("should render without crashing", () => {
    render(<${componentName} />);

    // TODO: Replace with an actual text or role query from the component
    expect(screen.getByRole("heading")).toBeDefined();
  });

  it("should display expected content", () => {
    render(<${componentName} />);

    // TODO: Assert on the expected text or elements
    expect(document.body.textContent).toBeTruthy();
  });

  it("should handle user interaction", async () => {
    const user = userEvent.setup();
    render(<${componentName} />);

    // TODO: Replace with an actual interactive element and expected outcome
    const button = screen.queryByRole("button");
    if (button) {
      await user.click(button);
      // TODO: Assert the expected state change after interaction
    }
  });
});
`;
}

/**
 * Test stub for pure utility/helper functions.
 * Input/output pattern with describe blocks.
 */
export function utilityTemplate(sourcePath: string): string {
  const moduleName = extractModuleName(sourcePath);
  const testPath = deriveTestPath(sourcePath);
  const importPath = computeRelativeImport(testPath, sourcePath);

  return `import { describe, it, expect } from "vitest";

// TODO: Update imports to match the actual exports from the source module
import { ${moduleName} } from "${importPath}.js";

describe("${moduleName}", () => {
  describe("when given valid input", () => {
    it("should return the expected output", () => {
      // TODO: Replace with actual input and expected output
      const input = undefined;
      const result = ${moduleName}(input);

      expect(result).toBeDefined();
    });
  });

  describe("when given edge-case input", () => {
    it("should handle empty input", () => {
      // TODO: Replace with actual edge-case input
      const result = ${moduleName}(undefined);

      expect(result).toBeDefined();
    });

    it("should handle null or undefined", () => {
      // TODO: Test null/undefined handling if applicable
      expect(() => ${moduleName}(null as never)).not.toThrow();
    });
  });

  describe("when given invalid input", () => {
    it("should throw or return an error indicator", () => {
      // TODO: Replace with actual invalid input
      const invalidInput = undefined;

      // TODO: Assert either a throw or an error return value
      expect(() => ${moduleName}(invalidInput)).toBeDefined();
    });
  });
});
`;
}

/**
 * Test stub for Express routes using supertest patterns.
 * Tests GET and POST endpoints.
 */
export function expressRouteTemplate(sourcePath: string): string {
  const moduleName = extractModuleName(sourcePath);
  const testPath = deriveTestPath(sourcePath);
  const importPath = computeRelativeImport(testPath, sourcePath);

  return `import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";

// TODO: Update import to match the actual export (router or route handler)
import { router } from "${importPath}.js";

describe("${moduleName} routes", () => {
  const app = express();
  app.use(express.json());
  // TODO: Update the mount path to match the actual route prefix
  app.use("/${moduleName}", router);

  describe("GET /${moduleName}", () => {
    it("should return 200 and a valid response", async () => {
      const res = await request(app).get("/${moduleName}");

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });

    it("should return the expected data structure", async () => {
      const res = await request(app).get("/${moduleName}");

      // TODO: Assert the shape of the response body
      expect(res.body).toBeDefined();
    });
  });

  describe("POST /${moduleName}", () => {
    it("should accept valid input and return 201", async () => {
      const res = await request(app)
        .post("/${moduleName}")
        .send({ /* TODO: add valid request body */ });

      expect(res.status).toBe(201);
    });

    it("should reject invalid input with 400", async () => {
      const res = await request(app)
        .post("/${moduleName}")
        .send({});

      // TODO: Assert the expected error response
      expect(res.status).toBe(400);
    });
  });
});
`;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Select the right template based on the file category and detected app framework.
 *
 * @param sourcePath  - Path to the source file being tested
 * @param category    - From TestCategory.name: "api-routes", "components", "utils",
 *                      "middleware", "models", "other"
 * @param appFramework - From TestAnalysisReport.framework.appFramework:
 *                       "nextjs-app", "nextjs-pages", "react-vite", "express",
 *                       "plain-ts", "unknown"
 */
export function generateTestTemplate(
  sourcePath: string,
  category: string,
  appFramework: string,
): string {
  // API routes: pick template based on the app framework
  if (category === "api-routes") {
    if (appFramework === "nextjs-app" || appFramework === "nextjs-pages") {
      return nextjsApiRouteTemplate(sourcePath);
    }
    if (appFramework === "express") {
      return expressRouteTemplate(sourcePath);
    }
    // Fallback: use utility template for unknown API route frameworks
    return utilityTemplate(sourcePath);
  }

  // Components: React component template for React-based frameworks
  if (category === "components") {
    if (
      appFramework === "nextjs-app" ||
      appFramework === "nextjs-pages" ||
      appFramework === "react-vite"
    ) {
      return reactComponentTemplate(sourcePath);
    }
    // Non-React components fall back to utility template
    return utilityTemplate(sourcePath);
  }

  // Middleware: Express middleware uses express template, others use utility
  if (category === "middleware") {
    if (appFramework === "express") {
      return expressRouteTemplate(sourcePath);
    }
    return utilityTemplate(sourcePath);
  }

  // Utils, models, other: all use the utility template
  return utilityTemplate(sourcePath);
}
