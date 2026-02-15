import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { scanStructure, scanRoutes, scanDataAPIs, scanAll } from "../../src/spec/scanner.js";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

const mockStat = stat as unknown as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockReaddir = readdir as unknown as ReturnType<typeof vi.fn>;

function statExists() {
  mockStat.mockResolvedValue({ isDirectory: () => false } as any);
}
function statMissing() {
  mockStat.mockRejectedValue(new Error("ENOENT"));
}

describe("scanStructure", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("detects TypeScript + Next.js from package.json", async () => {
    const pkg = JSON.stringify({
      name: "my-app",
      dependencies: { next: "14.0.0", "react-dom": "18.0.0" },
    });
    // stat: tsconfig.json exists, lockfile checks, config files, entry points
    mockStat.mockImplementation((p: string) => {
      if (p.includes("tsconfig.json") || p.includes("package-lock.json")) {
        return Promise.resolve({ isDirectory: () => false });
      }
      if (p.includes("src/index.ts") || p.includes("src/main.ts")) {
        return Promise.resolve({ isDirectory: () => false });
      }
      return Promise.reject(new Error("ENOENT"));
    });
    mockReadFile.mockImplementation((p: string) => {
      if (p.includes("package.json")) return Promise.resolve(pkg);
      return Promise.reject(new Error("ENOENT"));
    });
    mockReaddir.mockResolvedValue([
      { name: "src", isDirectory: () => true },
      { name: "public", isDirectory: () => true },
      { name: "node_modules", isDirectory: () => true },
    ]);

    const result = await scanStructure("/project");

    expect(result.projectName).toBe("my-app");
    expect(result.language).toBe("typescript");
    expect(result.packageManager).toBe("npm");
    expect(result.frameworks).toContain("Next.js");
    expect(result.frameworks).toContain("React");
    expect(result.topLevelDirs).toContain("src");
    expect(result.topLevelDirs).not.toContain("node_modules");
  });

  it("handles missing package.json gracefully", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    const result = await scanStructure("/empty");

    expect(result.projectName).toBe("empty");
    expect(result.language).toBe("unknown");
    expect(result.frameworks).toEqual([]);
    expect(result.topLevelDirs).toEqual([]);
  });
});

describe("scanRoutes", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("finds routes in Next.js app directory", async () => {
    const norm = (p: string) => p.replace(/\\/g, "/");
    // stat: src/app exists (used by exists() helper)
    mockStat.mockImplementation((p: string) => {
      const n = norm(p);
      if (n.endsWith("/src/app") || n.includes("/src/app/")) {
        return Promise.resolve({ isDirectory: () => true });
      }
      return Promise.reject(new Error("ENOENT"));
    });
    // readdir for src/app returns page files
    mockReaddir.mockImplementation((dir: string) => {
      const n = norm(dir);
      if (n.endsWith("/src/app")) {
        return Promise.resolve([
          { name: "page.tsx", isDirectory: () => false },
          { name: "api", isDirectory: () => true },
        ]);
      }
      if (n.includes("/api")) {
        return Promise.resolve([
          { name: "route.ts", isDirectory: () => false },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await scanRoutes("/project");

    expect(result.framework).toBe("Next.js (App Router)");
    expect(result.routeDir).toBe("src/app");
    expect(result.routes.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null framework when no route dir found", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await scanRoutes("/project");

    expect(result.framework).toBeNull();
    expect(result.routeDir).toBeNull();
    expect(result.routes).toEqual([]);
  });
});

describe("scanDataAPIs", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("detects external services and database from dependencies", async () => {
    const pkg = JSON.stringify({
      name: "api-app",
      dependencies: { "@prisma/client": "5.0.0", stripe: "12.0.0" },
    });
    mockReadFile.mockImplementation((p: string) => {
      if (p.includes("package.json")) return Promise.resolve(pkg);
      return Promise.reject(new Error("ENOENT"));
    });
    mockStat.mockRejectedValue(new Error("ENOENT"));
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    const result = await scanDataAPIs("/project");

    expect(result.externalServices).toContain("Stripe");
    expect(result.databaseType).toBe("PostgreSQL (Prisma)");
  });
});

describe("scanAll", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs all three scans in parallel and returns combined result", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    const result = await scanAll("/empty");

    expect(result).toHaveProperty("structure");
    expect(result).toHaveProperty("routes");
    expect(result).toHaveProperty("dataAPIs");
    expect(result.structure.projectName).toBe("empty");
    expect(result.routes.framework).toBeNull();
    expect(result.dataAPIs.apiEndpoints).toEqual([]);
  });
});
