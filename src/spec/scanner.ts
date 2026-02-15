import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface StructureScanResult {
  projectName: string;
  frameworks: string[];
  language: "typescript" | "javascript" | "unknown";
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  configFiles: string[];
  topLevelDirs: string[];
  entryPoints: string[];
}

export interface RouteInfo {
  path: string;
  file: string;
  type: "page" | "api" | "layout" | "component" | "middleware";
}

export interface RoutesScanResult {
  framework: string | null;
  routeDir: string | null;
  routes: RouteInfo[];
  components: string[];
}

export interface APIEndpoint {
  method: string;
  path: string;
  file: string;
}

export interface DataModel {
  name: string;
  file: string;
  source: "prisma" | "drizzle" | "mongoose" | "typeorm" | "sql" | "unknown";
}

export interface DataAPIsScanResult {
  apiEndpoints: APIEndpoint[];
  dataModels: DataModel[];
  externalServices: string[];
  databaseType: string | null;
}

export interface ScanAllResult {
  structure: StructureScanResult;
  routes: RoutesScanResult;
  dataAPIs: DataAPIsScanResult;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".svelte-kit", ".output", "coverage", ".turbo", ".cache",
]);

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(p, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function walkDir(
  dir: string,
  base: string,
  maxDepth: number,
  depth = 0,
): Promise<string[]> {
  if (depth > maxDepth) return [];
  let entries: string[];
  try {
    const items = await readdir(dir, { withFileTypes: true });
    entries = [];
    for (const item of items) {
      const full = join(dir, item.name);
      const rel = relative(base, full);
      if (item.isDirectory()) {
        if (!IGNORE_DIRS.has(item.name)) {
          entries.push(rel + "/");
          const sub = await walkDir(full, base, maxDepth, depth + 1);
          entries.push(...sub);
        }
      } else {
        entries.push(rel);
      }
    }
  } catch {
    entries = [];
  }
  return entries;
}

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"]);

function isCodeFile(file: string): boolean {
  return CODE_EXTS.has(extname(file));
}

// ── Structure Scan ─────────────────────────────────────────────────────────

const FRAMEWORK_MARKERS: Record<string, string> = {
  next: "Next.js",
  nuxt: "Nuxt",
  "react-dom": "React",
  vue: "Vue",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  angular: "Angular",
  "@angular/core": "Angular",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  koa: "Koa",
  "react-native": "React Native",
  expo: "Expo",
  electron: "Electron",
  astro: "Astro",
  remix: "Remix",
  gatsby: "Gatsby",
  "@nestjs/core": "NestJS",
};

const CONFIG_FILES = [
  "tsconfig.json", "jsconfig.json",
  "tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs",
  "postcss.config.js", "postcss.config.mjs",
  "vite.config.ts", "vite.config.js",
  "next.config.ts", "next.config.js", "next.config.mjs",
  "nuxt.config.ts",
  "svelte.config.js",
  "astro.config.mjs",
  ".env", ".env.local", ".env.example",
  "docker-compose.yml", "Dockerfile",
  ".eslintrc.json", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs",
  "biome.json", "biome.jsonc",
  "vitest.config.ts", "jest.config.ts", "jest.config.js",
  "playwright.config.ts",
  ".prettierrc", ".prettierrc.json",
  "drizzle.config.ts", "prisma/schema.prisma",
];

const ENTRY_CANDIDATES = [
  "src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx",
  "src/app.ts", "src/app.tsx", "src/server.ts",
  "index.ts", "index.js", "app.ts", "server.ts",
  "src/index.js", "src/main.js", "src/app.js",
];

export async function scanStructure(projectDir: string): Promise<StructureScanResult> {
  const pkg = await readJson(join(projectDir, "package.json"));

  // Project name
  const projectName = (pkg?.name as string) || basename(projectDir);

  // Detect frameworks from dependencies
  const allDeps: Record<string, unknown> = {
    ...(typeof pkg?.dependencies === "object" ? (pkg.dependencies as Record<string, unknown>) : {}),
    ...(typeof pkg?.devDependencies === "object" ? (pkg.devDependencies as Record<string, unknown>) : {}),
  };
  const frameworks: string[] = [];
  for (const [dep, label] of Object.entries(FRAMEWORK_MARKERS)) {
    if (dep in allDeps) {
      frameworks.push(label);
    }
  }
  // Deduplicate (e.g. React appears via react-dom and next)
  const uniqueFrameworks = [...new Set(frameworks)];

  // Language
  const hasTs = await exists(join(projectDir, "tsconfig.json"));
  const language: StructureScanResult["language"] = hasTs
    ? "typescript"
    : pkg ? "javascript" : "unknown";

  // Package manager
  let packageManager: StructureScanResult["packageManager"] = "unknown";
  if (await exists(join(projectDir, "bun.lockb")) || await exists(join(projectDir, "bun.lock"))) {
    packageManager = "bun";
  } else if (await exists(join(projectDir, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (await exists(join(projectDir, "yarn.lock"))) {
    packageManager = "yarn";
  } else if (await exists(join(projectDir, "package-lock.json"))) {
    packageManager = "npm";
  }

  // Config files present
  const configFiles: string[] = [];
  for (const cf of CONFIG_FILES) {
    if (await exists(join(projectDir, cf))) {
      configFiles.push(cf);
    }
  }

  // Top-level directories
  const topLevelDirs: string[] = [];
  try {
    const items = await readdir(projectDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory() && !IGNORE_DIRS.has(item.name) && !item.name.startsWith(".")) {
        topLevelDirs.push(item.name);
      }
    }
  } catch { /* empty */ }

  // Entry points
  const entryPoints: string[] = [];
  for (const ep of ENTRY_CANDIDATES) {
    if (await exists(join(projectDir, ep))) {
      entryPoints.push(ep);
    }
  }

  return {
    projectName,
    frameworks: uniqueFrameworks,
    language,
    packageManager,
    configFiles,
    topLevelDirs,
    entryPoints,
  };
}

// ── Routes / UI Scan ───────────────────────────────────────────────────────

const ROUTE_DIRS = [
  { dir: "app", framework: "Next.js (App Router)" },
  { dir: "pages", framework: "Next.js (Pages Router)" },
  { dir: "src/app", framework: "Next.js (App Router)" },
  { dir: "src/pages", framework: "Next.js (Pages Router)" },
  { dir: "src/routes", framework: "SvelteKit/Remix" },
  { dir: "routes", framework: "Remix" },
  { dir: "src/views", framework: "Vue" },
  { dir: "src/screens", framework: "React Native" },
];

const COMPONENT_DIRS = [
  "src/components", "components", "src/ui", "ui",
  "src/features", "src/modules",
];

function classifyRouteFile(filePath: string): RouteInfo["type"] {
  const name = basename(filePath).toLowerCase();
  if (name.startsWith("layout")) return "layout";
  if (name.startsWith("middleware") || name === "_middleware.ts" || name === "_middleware.js") return "middleware";
  if (filePath.includes("/api/") || filePath.includes("\\api\\")) return "api";
  return "page";
}

function fileToRoutePath(file: string, routeDir: string): string {
  let route = file
    .replace(routeDir, "")
    .replace(/\\/g, "/");

  // Strip file extension
  route = route.replace(/\.(ts|tsx|js|jsx|vue|svelte)$/, "");

  // Strip index suffix
  route = route.replace(/\/index$/, "") || "/";

  // Strip Next.js page.tsx pattern
  route = route.replace(/\/page$/, "") || "/";

  return route;
}

export async function scanRoutes(projectDir: string): Promise<RoutesScanResult> {
  let framework: string | null = null;
  let routeDir: string | null = null;
  const routes: RouteInfo[] = [];

  // Find the route directory
  for (const candidate of ROUTE_DIRS) {
    const fullPath = join(projectDir, candidate.dir);
    if (await exists(fullPath)) {
      framework = candidate.framework;
      routeDir = candidate.dir;
      break;
    }
  }

  // Scan routes if found
  if (routeDir) {
    const fullRouteDir = join(projectDir, routeDir);
    const files = await walkDir(fullRouteDir, fullRouteDir, 5);
    for (const file of files) {
      if (file.endsWith("/")) continue; // skip directories
      if (!isCodeFile(file)) continue;
      const name = basename(file).toLowerCase();
      // Skip test files and non-route utilities
      if (name.includes(".test.") || name.includes(".spec.") || name.startsWith("_")) continue;

      const type = classifyRouteFile(file);
      routes.push({
        path: fileToRoutePath(file, ""),
        file: join(routeDir, file),
        type,
      });
    }
  }

  // Scan component directories
  const components: string[] = [];
  for (const compDir of COMPONENT_DIRS) {
    const fullPath = join(projectDir, compDir);
    if (!(await exists(fullPath))) continue;
    const files = await walkDir(fullPath, fullPath, 3);
    for (const file of files) {
      if (file.endsWith("/")) continue;
      if (!isCodeFile(file)) continue;
      const name = basename(file).toLowerCase();
      if (name.includes(".test.") || name.includes(".spec.")) continue;
      components.push(join(compDir, file));
    }
  }

  return { framework, routeDir, routes, components };
}

// ── Data / APIs Scan ───────────────────────────────────────────────────────

const API_DIRS = [
  "src/api", "api", "src/server", "server",
  "src/controllers", "controllers",
  "src/handlers", "handlers",
  "app/api", "pages/api", "src/app/api", "src/pages/api",
];

const HTTP_METHOD_RE = /\.(get|post|put|patch|delete|all)\s*\(/gi;
const ROUTE_STRING_RE = /['"`](\/[a-zA-Z0-9/:_\-.*[\]{}]*?)['"`]/g;

async function extractAPIEndpoints(
  projectDir: string,
  filePath: string,
): Promise<APIEndpoint[]> {
  const endpoints: APIEndpoint[] = [];
  try {
    const content = await readFile(join(projectDir, filePath), "utf-8");

    // Check for HTTP method patterns (Express/Hono/Fastify style)
    let match: RegExpExecArray | null;
    const methodRe = new RegExp(HTTP_METHOD_RE.source, "gi");
    while ((match = methodRe.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      // Try to find route string near this match
      const nearby = content.slice(Math.max(0, match.index - 100), match.index + 200);
      const routeMatch = ROUTE_STRING_RE.exec(nearby);
      ROUTE_STRING_RE.lastIndex = 0;
      endpoints.push({
        method,
        path: routeMatch ? routeMatch[1] : "(dynamic)",
        file: filePath,
      });
    }

    // Next.js API route convention: file path IS the route
    if (filePath.includes("/api/")) {
      const routePath = "/" + filePath
        .replace(/.*\/api\//, "api/")
        .replace(/\.(ts|tsx|js|jsx)$/, "")
        .replace(/\/route$/, "")
        .replace(/\/index$/, "");

      // Check for exported HTTP methods (Next.js App Router)
      const exportedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
      for (const m of exportedMethods) {
        if (content.includes(`export function ${m}`) || content.includes(`export async function ${m}`)) {
          endpoints.push({ method: m, path: routePath, file: filePath });
        }
      }

      // If no explicit methods found, add a generic entry
      if (endpoints.filter(e => e.file === filePath).length === 0) {
        endpoints.push({ method: "ANY", path: routePath, file: filePath });
      }
    }
  } catch { /* unreadable file */ }

  return endpoints;
}

const PRISMA_MODEL_RE = /^model\s+(\w+)/gm;
const DRIZZLE_TABLE_RE = /export\s+const\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\(/g;
const MONGOOSE_MODEL_RE = /mongoose\.model\s*[<(]\s*['"`]?(\w+)/g;

async function extractDataModels(projectDir: string): Promise<DataModel[]> {
  const models: DataModel[] = [];

  // Prisma
  const prismaPath = join(projectDir, "prisma/schema.prisma");
  try {
    const content = await readFile(prismaPath, "utf-8");
    let match: RegExpExecArray | null;
    const re = new RegExp(PRISMA_MODEL_RE.source, "gm");
    while ((match = re.exec(content)) !== null) {
      models.push({ name: match[1], file: "prisma/schema.prisma", source: "prisma" });
    }
  } catch { /* no prisma */ }

  // Drizzle — look for schema files
  const drizzleCandidates = [
    "src/db/schema.ts", "src/schema.ts", "drizzle/schema.ts",
    "src/db/schema/index.ts", "src/lib/db/schema.ts",
  ];
  for (const candidate of drizzleCandidates) {
    try {
      const content = await readFile(join(projectDir, candidate), "utf-8");
      let match: RegExpExecArray | null;
      const re = new RegExp(DRIZZLE_TABLE_RE.source, "g");
      while ((match = re.exec(content)) !== null) {
        models.push({ name: match[1], file: candidate, source: "drizzle" });
      }
    } catch { /* not found */ }
  }

  // Mongoose — look for model files
  const mongooseDirs = ["src/models", "models", "src/db/models"];
  for (const dir of mongooseDirs) {
    try {
      const files = await readdir(join(projectDir, dir));
      for (const file of files) {
        if (!isCodeFile(file)) continue;
        const content = await readFile(join(projectDir, dir, file), "utf-8");
        let match: RegExpExecArray | null;
        const re = new RegExp(MONGOOSE_MODEL_RE.source, "g");
        while ((match = re.exec(content)) !== null) {
          models.push({ name: match[1], file: join(dir, file), source: "mongoose" });
        }
      }
    } catch { /* not found */ }
  }

  return models;
}

const EXTERNAL_SERVICE_MARKERS: Record<string, string> = {
  stripe: "Stripe",
  "@stripe/stripe-js": "Stripe",
  "@supabase/supabase-js": "Supabase",
  firebase: "Firebase",
  "firebase-admin": "Firebase Admin",
  "@aws-sdk": "AWS",
  "@azure": "Azure",
  "@google-cloud": "Google Cloud",
  "@sendgrid/mail": "SendGrid",
  resend: "Resend",
  "@clerk/nextjs": "Clerk Auth",
  "@auth/core": "Auth.js",
  "next-auth": "NextAuth",
  "@lucia-auth/core": "Lucia Auth",
  "@upstash/redis": "Upstash Redis",
  ioredis: "Redis",
  "@sentry/node": "Sentry",
  posthog: "PostHog",
  "@vercel/analytics": "Vercel Analytics",
  openai: "OpenAI",
  "@anthropic-ai/sdk": "Anthropic",
  "@pinecone-database/pinecone": "Pinecone",
  "@linear/sdk": "Linear",
};

const DB_TYPE_MARKERS: Record<string, string> = {
  "@prisma/client": "PostgreSQL (Prisma)",
  pg: "PostgreSQL",
  mysql2: "MySQL",
  "better-sqlite3": "SQLite",
  "@libsql/client": "SQLite (Turso)",
  mongoose: "MongoDB",
  mongodb: "MongoDB",
  "@neondatabase/serverless": "PostgreSQL (Neon)",
  "@planetscale/database": "MySQL (PlanetScale)",
};

export async function scanDataAPIs(projectDir: string): Promise<DataAPIsScanResult> {
  const pkg = await readJson(join(projectDir, "package.json"));
  const allDeps: Record<string, unknown> = {
    ...(typeof pkg?.dependencies === "object" ? (pkg.dependencies as Record<string, unknown>) : {}),
    ...(typeof pkg?.devDependencies === "object" ? (pkg.devDependencies as Record<string, unknown>) : {}),
  };

  // External services
  const externalServices: string[] = [];
  for (const [dep, label] of Object.entries(EXTERNAL_SERVICE_MARKERS)) {
    const found = dep.startsWith("@")
      ? Object.keys(allDeps).some(d => d.startsWith(dep))
      : dep in allDeps;
    if (found) {
      externalServices.push(label);
    }
  }

  // Database type
  let databaseType: string | null = null;
  for (const [dep, label] of Object.entries(DB_TYPE_MARKERS)) {
    if (dep in allDeps) {
      databaseType = label;
      break;
    }
  }

  // API endpoints
  const apiEndpoints: APIEndpoint[] = [];
  for (const apiDir of API_DIRS) {
    const fullPath = join(projectDir, apiDir);
    if (!(await exists(fullPath))) continue;
    const files = await walkDir(fullPath, fullPath, 4);
    for (const file of files) {
      if (file.endsWith("/")) continue;
      if (!isCodeFile(file)) continue;
      const name = basename(file).toLowerCase();
      if (name.includes(".test.") || name.includes(".spec.")) continue;
      const eps = await extractAPIEndpoints(projectDir, join(apiDir, file));
      apiEndpoints.push(...eps);
    }
  }

  // Also check for standalone server files
  const serverFiles = ["src/server.ts", "server.ts", "src/app.ts", "app.ts", "src/index.ts"];
  for (const sf of serverFiles) {
    if (await exists(join(projectDir, sf))) {
      const eps = await extractAPIEndpoints(projectDir, sf);
      apiEndpoints.push(...eps);
    }
  }

  // Data models
  const dataModels = await extractDataModels(projectDir);

  return {
    apiEndpoints,
    dataModels,
    externalServices: [...new Set(externalServices)],
    databaseType,
  };
}

// ── Combined Scan ──────────────────────────────────────────────────────────

export async function scanAll(projectDir: string): Promise<ScanAllResult> {
  const [structure, routes, dataAPIs] = await Promise.all([
    scanStructure(projectDir),
    scanRoutes(projectDir),
    scanDataAPIs(projectDir),
  ]);

  return { structure, routes, dataAPIs };
}
