import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface VersionCache {
  timestamp: string;
  latestVersion: string;
}

function cachePath(projectDir: string): string {
  return join(projectDir, ".forge", "version-check.json");
}

async function readCache(projectDir: string): Promise<VersionCache | null> {
  try {
    const raw = await readFile(cachePath(projectDir), "utf-8");
    return JSON.parse(raw) as VersionCache;
  } catch {
    return null;
  }
}

async function writeCache(projectDir: string, cache: VersionCache): Promise<void> {
  const p = cachePath(projectDir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(cache, null, 2), "utf-8");
}

function isCacheFresh(cache: VersionCache): boolean {
  const cacheTime = new Date(cache.timestamp).getTime();
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return now - cacheTime < ONE_DAY_MS;
}

async function getCurrentVersion(): Promise<string> {
  const pkgPath = join(__dirname, "..", "..", "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version: string };
  return pkg.version;
}

async function fetchLatestVersion(): Promise<string> {
  const response = await fetch("https://registry.npmjs.org/forge-cc/latest");
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`);
  }
  const data = (await response.json()) as { version: string };
  return data.version;
}

export async function checkForUpdate(projectDir: string): Promise<void> {
  // Check cache first
  const cache = await readCache(projectDir);
  if (cache && isCacheFresh(cache)) {
    const current = await getCurrentVersion();
    if (cache.latestVersion !== current) {
      console.log(
        `forge-cc v${cache.latestVersion} is available (current: v${current}). Run: npm install -g forge-cc`,
      );
    }
    return;
  }

  // Fetch from registry
  try {
    const latestVersion = await fetchLatestVersion();
    const current = await getCurrentVersion();

    // Write cache
    await writeCache(projectDir, {
      timestamp: new Date().toISOString(),
      latestVersion,
    });

    if (latestVersion !== current) {
      console.log(
        `forge-cc v${latestVersion} is available (current: v${current}). Run: npm install -g forge-cc`,
      );
    } else {
      console.log(`forge-cc v${current} is up to date.`);
    }
  } catch (err) {
    console.warn("[forge] Version check failed:", err);
  }
}
