import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { readFileSync, existsSync } from "node:fs";
import { loadConfig } from "../../src/config/loader.js";

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and parses a .forge.json file", () => {
    const forgeConfig = {
      gates: ["types", "lint"],
      maxIterations: 3,
      verifyFreshness: 300_000,
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(forgeConfig));

    const config = loadConfig("/fake/project");

    expect(config.gates).toEqual(["types", "lint"]);
    expect(config.maxIterations).toBe(3);
    expect(config.verifyFreshness).toBe(300_000);
  });

  it("applies Zod defaults for missing optional fields in .forge.json", () => {
    const forgeConfig = {
      gates: ["types"],
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(forgeConfig));

    const config = loadConfig("/fake/project");

    expect(config.gates).toEqual(["types"]);
    expect(config.maxIterations).toBe(5); // default
    expect(config.verifyFreshness).toBe(600_000); // default
  });

  it("parses devServer config from .forge.json", () => {
    const forgeConfig = {
      gates: ["types"],
      devServer: { command: "npm run dev", port: 3000, readyPattern: "ready" },
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(forgeConfig));

    const config = loadConfig("/fake/project");

    expect(config.devServer).toEqual({
      command: "npm run dev",
      port: 3000,
      readyPattern: "ready",
    });
  });

  it("auto-detects gates from package.json when .forge.json is absent", () => {
    const pkg = {
      dependencies: {},
      devDependencies: {
        typescript: "^5.0.0",
        "@biomejs/biome": "^1.0.0",
      },
      scripts: {
        test: "vitest run",
      },
    };

    // .forge.json does not exist
    mockExistsSync.mockReturnValue(false);
    // readFileSync is called for package.json
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg));

    const config = loadConfig("/fake/project");

    expect(config.gates).toEqual(["types", "lint", "tests"]);
    expect(config.maxIterations).toBe(5);
    expect(config.verifyFreshness).toBe(600_000);
  });

  it("auto-detects only typescript gate if no biome or test script", () => {
    const pkg = {
      dependencies: {},
      devDependencies: {
        typescript: "^5.0.0",
      },
      scripts: {},
    };

    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg));

    const config = loadConfig("/fake/project");

    expect(config.gates).toEqual(["types"]);
  });

  it("detects biome via the 'biome' package name", () => {
    const pkg = {
      dependencies: {},
      devDependencies: {
        biome: "^1.0.0",
      },
      scripts: {},
    };

    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg));

    const config = loadConfig("/fake/project");

    expect(config.gates).toContain("lint");
  });

  it("falls back to all default gates when no package.json exists", () => {
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    const config = loadConfig("/fake/project");

    expect(config.gates).toEqual(["types", "lint", "tests"]);
    expect(config.maxIterations).toBe(5);
  });

  it("falls back to all defaults when package.json has no deps and no scripts", () => {
    const pkg = {};

    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(JSON.stringify(pkg));

    const config = loadConfig("/fake/project");

    // gates will be empty from auto-detect, then fallback to defaults
    expect(config.gates).toEqual(["types", "lint", "tests"]);
  });

  it("throws on invalid .forge.json (Zod validation error)", () => {
    const invalidConfig = {
      gates: "not-an-array", // should be string[]
      maxIterations: -1, // should be positive
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidConfig));

    expect(() => loadConfig("/fake/project")).toThrow();
  });

  it("throws on malformed JSON in .forge.json", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{invalid json");

    expect(() => loadConfig("/fake/project")).toThrow();
  });
});
