import {
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write content to a file atomically using temp+rename.
 * On Windows, rename can fail if another process has the file open --
 * retry with exponential backoff (3 attempts: 50ms, 100ms, 200ms).
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const resolved = resolve(filePath);
  const dir = dirname(resolved);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpFile = resolved + ".tmp." + randomBytes(4).toString("hex");
  writeFileSync(tmpFile, content, "utf-8");

  const delays = [50, 100, 200];

  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      renameSync(tmpFile, resolved);
      return;
    } catch (err: unknown) {
      const isLastAttempt = attempt === delays.length - 1;
      if (isLastAttempt) {
        // Clean up temp file on final failure, then rethrow
        try {
          unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
        throw err;
      }
      // Synchronous sleep for retry backoff
      const waitUntil = Date.now() + delays[attempt];
      while (Date.now() < waitUntil) {
        // Busy-wait (sync context, no async available)
      }
    }
  }
}

/**
 * Read and parse a JSON file. Returns null if the file doesn't exist.
 * Throws on parse errors.
 */
export function readJsonFileSync<T>(filePath: string): T | null {
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    return null;
  }

  const raw = readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as T;
}

/**
 * Atomically write a JSON object to a file with pretty printing.
 */
export function writeJsonFileSync(filePath: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + "\n";
  atomicWriteFileSync(filePath, content);
}

/**
 * Generate a short 8-character hex session ID from random bytes.
 */
export function generateSessionId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Normalize a path using path.resolve and path.join.
 * Ensures consistent separators on all platforms.
 */
export function normalizePath(...segments: string[]): string {
  return resolve(join(...segments));
}

/**
 * Quote a string for safe shell usage.
 * On Windows, uses double quotes. On POSIX, uses single quotes with escaping.
 */
export function shellQuote(value: string): string {
  if (process.platform === "win32") {
    // Windows: wrap in double quotes, escape internal double quotes
    const escaped = value.replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  // POSIX: wrap in single quotes, escape internal single quotes
  // Replace ' with '\'' (end quote, escaped quote, start quote)
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}
