// ── Structural Test Templates ───────────────────────────────────────
// Template functions that generate self-contained structural/architectural
// test files. Each template returns a string of valid TypeScript test code
// using describe/it/expect (vitest/jest compatible).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructuralTestOptions {
  sourceDir: string;
  testDir: string;
  entryPoints?: string[];
}

// ---------------------------------------------------------------------------
// Template: No Circular Imports
// ---------------------------------------------------------------------------

export function circularImportTemplate(sourceDir: string): string {
  return `import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Structural test: detect circular import dependencies.
 * Scans all .ts/.tsx files under the source directory, builds an adjacency
 * list of file-level imports, and fails if any cycle is found.
 */

const SOURCE_DIR = ${JSON.stringify(sourceDir)};

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectTsFiles(full));
    } else if (/\\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

function parseImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const importRegex = /(?:import|export)\\s.*?from\\s+["'](.+?)["']/g;
  const imports: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1];
    // Only resolve relative imports
    if (!specifier.startsWith(".")) continue;
    const dir = path.dirname(filePath);
    let resolved = path.resolve(dir, specifier);
    // Strip .js extension to match .ts source files
    resolved = resolved.replace(/\\.js$/, "");
    // Try common extensions
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const candidate = resolved + ext;
      if (fs.existsSync(candidate)) {
        imports.push(candidate);
        break;
      }
    }
  }
  return imports;
}

function detectCycles(
  graph: Map<string, string[]>,
): string[][] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, pathSoFar: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = pathSoFar.indexOf(node);
      cycles.push(pathSoFar.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    const neighbors = graph.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor, [...pathSoFar, node]);
    }
    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node, []);
  }
  return cycles;
}

describe("No Circular Imports", () => {
  it("should have no circular import dependencies", () => {
    const absSource = path.resolve(SOURCE_DIR);
    const files = collectTsFiles(absSource);
    const graph = new Map<string, string[]>();

    for (const file of files) {
      graph.set(file, parseImports(file));
    }

    const cycles = detectCycles(graph);

    if (cycles.length > 0) {
      const formatted = cycles
        .map((c) => c.map((f) => path.relative(absSource, f)).join(" -> "))
        .join("\\n  ");
      expect.fail(
        \`Found \${cycles.length} circular import(s):\\n  \${formatted}\`,
      );
    }
  });
});
`;
}

// ---------------------------------------------------------------------------
// Template: Consistent File Naming
// ---------------------------------------------------------------------------

export function fileNamingTemplate(sourceDir: string): string {
  return `import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Structural test: enforce consistent kebab-case file naming.
 * All .ts/.tsx source files must use kebab-case (e.g., my-component.ts).
 * index.ts / index.tsx files are allowed.
 */

const SOURCE_DIR = ${JSON.stringify(sourceDir)};

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectTsFiles(full));
    } else if (/\\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

/** Check if a filename (without extension) is valid kebab-case */
function isKebabCase(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

describe("Consistent File Naming", () => {
  it("should use kebab-case for all source file names", () => {
    const absSource = path.resolve(SOURCE_DIR);
    const files = collectTsFiles(absSource);
    const violations: string[] = [];

    for (const file of files) {
      const basename = path.basename(file);
      const nameWithoutExt = basename.replace(/\\.tsx?$/, "");

      // Allow index files
      if (nameWithoutExt === "index") continue;

      if (!isKebabCase(nameWithoutExt)) {
        violations.push(path.relative(absSource, file));
      }
    }

    if (violations.length > 0) {
      expect.fail(
        \`Found \${violations.length} file(s) not using kebab-case:\\n  \${violations.join("\\n  ")}\`,
      );
    }
  });
});
`;
}

// ---------------------------------------------------------------------------
// Template: Export Boundary Validation
// ---------------------------------------------------------------------------

export function exportBoundaryTemplate(
  sourceDir: string,
  entryPoints: string[],
): string {
  return `import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Structural test: validate public API export boundaries.
 * Checks that entry point files only re-export from expected local modules,
 * and that no internal-only modules are accidentally exposed.
 */

const SOURCE_DIR = ${JSON.stringify(sourceDir)};
const ENTRY_POINTS: string[] = ${JSON.stringify(entryPoints)};

function parseExports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const exportRegex = /export\\s.*?from\\s+["'](.+?)["']/g;
  const exports: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return exports;
}

describe("Export Boundary Validation", () => {
  it("entry point files should exist", () => {
    const absSource = path.resolve(SOURCE_DIR);
    for (const entry of ENTRY_POINTS) {
      const fullPath = path.resolve(absSource, entry);
      expect(
        fs.existsSync(fullPath),
        \`Entry point \${entry} does not exist at \${fullPath}\`,
      ).toBe(true);
    }
  });

  it("entry points should only re-export from relative paths", () => {
    const absSource = path.resolve(SOURCE_DIR);
    const violations: string[] = [];

    for (const entry of ENTRY_POINTS) {
      const fullPath = path.resolve(absSource, entry);
      if (!fs.existsSync(fullPath)) continue;

      const exports = parseExports(fullPath);
      for (const specifier of exports) {
        if (!specifier.startsWith(".")) {
          violations.push(\`\${entry}: re-exports from non-relative "\${specifier}"\`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        \`Found \${violations.length} unexpected re-export(s):\\n  \${violations.join("\\n  ")}\`,
      );
    }
  });

  it("entry points should not export from deeply nested internal paths", () => {
    const absSource = path.resolve(SOURCE_DIR);
    const violations: string[] = [];

    for (const entry of ENTRY_POINTS) {
      const fullPath = path.resolve(absSource, entry);
      if (!fs.existsSync(fullPath)) continue;

      const exports = parseExports(fullPath);
      for (const specifier of exports) {
        if (!specifier.startsWith(".")) continue;
        // Flag paths that go more than two levels deep (e.g., ./a/b/c/internal)
        const depth = specifier.split("/").filter((s) => s !== "." && s !== "..").length;
        if (depth > 2) {
          violations.push(\`\${entry}: deep internal export "\${specifier}"\`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        \`Found \${violations.length} deep internal export(s) that may expose internals:\\n  \${violations.join("\\n  ")}\`,
      );
    }
  });
});
`;
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

export function generateStructuralTests(
  options: StructuralTestOptions,
): Array<{ path: string; content: string }> {
  const { sourceDir, testDir, entryPoints } = options;
  const results: Array<{ path: string; content: string }> = [];

  // Always include circular import detection and file naming
  results.push({
    path: `${testDir}/structural/no-circular-imports.test.ts`,
    content: circularImportTemplate(sourceDir),
  });

  results.push({
    path: `${testDir}/structural/file-naming.test.ts`,
    content: fileNamingTemplate(sourceDir),
  });

  // Include export boundary validation if entry points are specified
  if (entryPoints && entryPoints.length > 0) {
    results.push({
      path: `${testDir}/structural/export-boundaries.test.ts`,
      content: exportBoundaryTemplate(sourceDir, entryPoints),
    });
  }

  return results;
}
