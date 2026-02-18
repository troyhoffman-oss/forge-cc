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
      devServer: { command: "npm run dev", port: 3000 },
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(forgeConfig));

    const config = loadConfig("/fake/project");

    expect(config.devServer).toEqual({
      command: "npm run dev",
      port: 3000,
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

  it("falls back to auto-detect on invalid .forge.json (Zod validation error)", () => {
    const invalidConfig = {
      gates: "not-an-array", // should be string[]
      maxIterations: -1, // should be positive
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidConfig));

    // Graceful degradation: falls back to auto-detect instead of throwing
    const config = loadConfig("/fake/project");
    expect(config).toBeDefined();
    expect(Array.isArray(config.gates)).toBe(true);
  });

  it("falls back to auto-detect on malformed JSON in .forge.json", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{invalid json");

    // Graceful degradation: falls back to auto-detect instead of throwing
    const config = loadConfig("/fake/project");
    expect(config).toBeDefined();
    expect(Array.isArray(config.gates)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Testing config section
  // -----------------------------------------------------------------------

  describe("testing config", () => {
    it("parses testing config from .forge.json", () => {
      const forgeConfig = {
        gates: ["types", "tests"],
        testing: {
          enforce: true,
          runner: "vitest",
          testDir: "tests",
          sourceDir: "src",
          structural: true,
          categories: ["utils", "api-routes"],
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(forgeConfig));

      const config = loadConfig("/fake/project");

      expect(config.testing).toBeDefined();
      expect(config.testing!.enforce).toBe(true);
      expect(config.testing!.runner).toBe("vitest");
      expect(config.testing!.testDir).toBe("tests");
      expect(config.testing!.sourceDir).toBe("src");
      expect(config.testing!.structural).toBe(true);
      expect(config.testing!.categories).toEqual(["utils", "api-routes"]);
    });

    it("applies Zod defaults for missing testing fields", () => {
      const forgeConfig = {
        gates: ["types"],
        testing: {
          // Only provide enforce; everything else should get defaults
          enforce: false,
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(forgeConfig));

      const config = loadConfig("/fake/project");

      expect(config.testing).toBeDefined();
      expect(config.testing!.enforce).toBe(false);
      expect(config.testing!.runner).toBe("vitest"); // default
      expect(config.testing!.testDir).toBe("tests"); // default
      expect(config.testing!.sourceDir).toBe("src"); // default
      expect(config.testing!.structural).toBe(true); // default
      expect(config.testing!.categories).toEqual([]); // default
    });

    it("auto-detects testing config with vitest in devDependencies", () => {
      const pkg = {
        dependencies: {},
        devDependencies: {
          typescript: "^5.0.0",
          vitest: "^1.0.0",
        },
        scripts: {
          test: "vitest run",
        },
      };

      // .forge.json does not exist; "tests" dir exists for detectTestDir
      mockExistsSync.mockImplementation((p: any) => {
        const pathStr = String(p).replace(/\\/g, "/");
        if (pathStr.endsWith(".forge.json")) return false;
        if (pathStr.endsWith("/tests")) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(pkg));

      const config = loadConfig("/fake/project");

      expect(config.testing).toBeDefined();
      expect(config.testing!.runner).toBe("vitest");
      expect(config.testing!.enforce).toBe(false); // auto-detect defaults to false
      expect(config.testing!.testDir).toBe("tests");
    });

    it("auto-detects testing config with jest in devDependencies", () => {
      const pkg = {
        dependencies: {},
        devDependencies: {
          typescript: "^5.0.0",
          jest: "^29.0.0",
        },
        scripts: {
          test: "jest",
        },
      };

      mockExistsSync.mockImplementation((p: any) => {
        const pathStr = String(p).replace(/\\/g, "/");
        if (pathStr.endsWith(".forge.json")) return false;
        // __tests__ dir exists instead of tests
        if (pathStr.endsWith("/__tests__")) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(pkg));

      const config = loadConfig("/fake/project");

      expect(config.testing).toBeDefined();
      expect(config.testing!.runner).toBe("jest");
      expect(config.testing!.testDir).toBe("__tests__");
    });

    it("returns no testing config when no test runner detected", () => {
      const pkg = {
        dependencies: {},
        devDependencies: {
          typescript: "^5.0.0",
        },
        scripts: {},
      };

      mockExistsSync.mockImplementation((p: any) => {
        const pathStr = String(p).replace(/\\/g, "/");
        if (pathStr.endsWith(".forge.json")) return false;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(pkg));

      const config = loadConfig("/fake/project");

      expect(config.testing).toBeUndefined();
    });
  });
});
