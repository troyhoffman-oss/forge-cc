import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  atomicWriteFileSync,
  readJsonFileSync,
  writeJsonFileSync,
  generateSessionId,
  normalizePath,
  shellQuote,
} from "../../src/utils/platform.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "forge-platform-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("atomicWriteFileSync", () => {
  it("writes file with correct content", () => {
    const filePath = join(tempDir, "test.txt");
    atomicWriteFileSync(filePath, "hello world");

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("hello world");
  });

  it("creates parent directories if they do not exist", () => {
    const filePath = join(tempDir, "nested", "deep", "file.txt");
    atomicWriteFileSync(filePath, "nested content");

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("nested content");
  });

  it("overwrites an existing file", () => {
    const filePath = join(tempDir, "overwrite.txt");
    atomicWriteFileSync(filePath, "first");
    atomicWriteFileSync(filePath, "second");

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("second");
  });

  it("does not leave temp files on success", () => {
    const filePath = join(tempDir, "clean.txt");
    atomicWriteFileSync(filePath, "data");

    const files = require("node:fs").readdirSync(tempDir) as string[];
    const tmpFiles = files.filter((f: string) => f.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("readJsonFileSync", () => {
  it("reads and parses valid JSON", () => {
    const filePath = join(tempDir, "data.json");
    atomicWriteFileSync(filePath, JSON.stringify({ key: "value", num: 42 }));

    const result = readJsonFileSync<{ key: string; num: number }>(filePath);
    expect(result).toEqual({ key: "value", num: 42 });
  });

  it("returns null for a file that does not exist", () => {
    const result = readJsonFileSync(join(tempDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("throws on invalid JSON", () => {
    const filePath = join(tempDir, "bad.json");
    atomicWriteFileSync(filePath, "{invalid json}");

    expect(() => readJsonFileSync(filePath)).toThrow();
  });

  it("handles arrays", () => {
    const filePath = join(tempDir, "array.json");
    atomicWriteFileSync(filePath, JSON.stringify([1, 2, 3]));

    const result = readJsonFileSync<number[]>(filePath);
    expect(result).toEqual([1, 2, 3]);
  });
});

describe("writeJsonFileSync", () => {
  it("writes pretty-printed JSON atomically", () => {
    const filePath = join(tempDir, "output.json");
    const data = { name: "forge", version: 1 };
    writeJsonFileSync(filePath, data);

    const raw = readFileSync(filePath, "utf-8");
    expect(raw).toBe(JSON.stringify(data, null, 2) + "\n");
  });

  it("creates parent directories", () => {
    const filePath = join(tempDir, "sub", "dir", "config.json");
    writeJsonFileSync(filePath, { ok: true });

    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(parsed).toEqual({ ok: true });
  });

  it("round-trips data through writeJsonFileSync and readJsonFileSync", () => {
    const filePath = join(tempDir, "roundtrip.json");
    const data = { sessions: [{ id: "abc123", active: true }] };
    writeJsonFileSync(filePath, data);

    const result = readJsonFileSync(filePath);
    expect(result).toEqual(data);
  });
});

describe("generateSessionId", () => {
  it("returns an 8-character string", () => {
    const id = generateSessionId();
    expect(id).toHaveLength(8);
  });

  it("returns only hexadecimal characters", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("generates unique IDs across multiple calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateSessionId());
    }
    // With 4 bytes of randomness, collisions in 100 calls are astronomically unlikely
    expect(ids.size).toBe(100);
  });
});

describe("normalizePath", () => {
  it("joins multiple segments into a single resolved path", () => {
    const result = normalizePath("/base", "sub", "file.txt");
    expect(result).toBe(resolve(join("/base", "sub", "file.txt")));
  });

  it("resolves relative paths to absolute", () => {
    const result = normalizePath("relative", "path");
    expect(result).toBe(resolve(join("relative", "path")));
    // Should be an absolute path
    expect(result).toMatch(/^(\/|[A-Z]:\\)/i);
  });

  it("handles a single segment", () => {
    const result = normalizePath("/tmp");
    expect(result).toBe(resolve("/tmp"));
  });

  it("normalizes away . and .. segments", () => {
    const result = normalizePath("/base", "sub", "..", "other");
    expect(result).toBe(resolve(join("/base", "other")));
  });
});

describe("shellQuote", () => {
  it("wraps a simple value in quotes", () => {
    const quoted = shellQuote("hello");
    if (process.platform === "win32") {
      expect(quoted).toBe('"hello"');
    } else {
      expect(quoted).toBe("'hello'");
    }
  });

  it("handles values with spaces", () => {
    const quoted = shellQuote("hello world");
    if (process.platform === "win32") {
      expect(quoted).toBe('"hello world"');
    } else {
      expect(quoted).toBe("'hello world'");
    }
  });

  it("escapes embedded double quotes on Windows", () => {
    if (process.platform !== "win32") return;
    const quoted = shellQuote('say "hi"');
    expect(quoted).toBe('"say \\"hi\\""');
  });

  it("escapes embedded single quotes on POSIX", () => {
    if (process.platform === "win32") return;
    const quoted = shellQuote("it's");
    expect(quoted).toBe("'it'\\''s'");
  });

  it("handles empty strings", () => {
    const quoted = shellQuote("");
    if (process.platform === "win32") {
      expect(quoted).toBe('""');
    } else {
      expect(quoted).toBe("''");
    }
  });

  it("handles special shell characters", () => {
    const quoted = shellQuote("$PATH && rm -rf /");
    // The value should be wrapped in quotes to prevent shell interpretation
    expect(quoted.length).toBeGreaterThan("$PATH && rm -rf /".length);
  });
});
