import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isCodexActivity, fetchAllPages } from "../src/codex-poll.js";

describe("isCodexActivity", () => {
  it("returns true for exact codex login", () => {
    expect(isCodexActivity({ user: { login: "codex" } })).toBe(true);
  });

  it("returns true for codex-bot login", () => {
    expect(isCodexActivity({ user: { login: "codex-bot" } })).toBe(true);
  });

  it("returns true for github-codex login", () => {
    expect(isCodexActivity({ user: { login: "github-codex" } })).toBe(true);
  });

  it("returns true for case-insensitive codex login", () => {
    expect(isCodexActivity({ user: { login: "Codex" } })).toBe(true);
  });

  it("returns true for exact codex app slug", () => {
    expect(isCodexActivity({ performed_via_github_app: { slug: "codex" } })).toBe(true);
  });

  it("returns false for non-codex user", () => {
    expect(isCodexActivity({ user: { login: "some-user" } })).toBe(false);
  });

  it("returns false for user with codex substring in name", () => {
    expect(isCodexActivity({ user: { login: "my-codex-fork" } })).toBe(false);
  });

  it("returns false for app with codex substring in slug", () => {
    expect(isCodexActivity({ performed_via_github_app: { slug: "not-codex-app" } })).toBe(false);
  });

  it("returns false for empty item", () => {
    expect(isCodexActivity({})).toBe(false);
  });
});

describe("fetchAllPages", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches single page of results", async () => {
    const data = [{ id: 1 }, { id: 2 }];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
      headers: new Headers(),
    });

    const result = await fetchAllPages("https://api.github.com/test", {});
    expect(result).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("follows Link header for pagination", async () => {
    const page1 = [{ id: 1 }];
    const page2 = [{ id: 2 }];

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page1),
        headers: new Headers({
          link: '<https://api.github.com/test?page=2&per_page=100>; rel="next"',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(page2),
        headers: new Headers(),
      });

    const result = await fetchAllPages("https://api.github.com/test", {});
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(
      fetchAllPages("https://api.github.com/test", {}),
    ).rejects.toThrow("GitHub API error: 403 Forbidden");
  });
});

describe("pollForCodexReview timeout path", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Use non-throwing mock to avoid unhandled rejections with fake timers
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exits with found:false after exhausting all polls with no Codex activity", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "test-token";

    // Mock fetch to always return empty arrays (no codex reviews or comments)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
      headers: new Headers(),
    });

    const { pollForCodexReview } = await import("../src/codex-poll.js");

    vi.useFakeTimers();

    const pollPromise = pollForCodexReview({ owner: "test", repo: "repo", pr: "1" });

    // Advance through all 8 poll intervals (7 waits of 60s each)
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    await pollPromise;
    expect(exitSpy).toHaveBeenCalledWith(1);

    if (origToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = origToken;
    }
  });
});
