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

describe("pollForCodexReview", () => {
  let originalFetch: typeof globalThis.fetch;
  let origToken: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    origToken = process.env.GITHUB_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (origToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = origToken;
    }
  });

  it("returns found:false with error when GITHUB_TOKEN is not set", async () => {
    delete process.env.GITHUB_TOKEN;
    const { pollForCodexReview } = await import("../src/codex-poll.js");

    const result = await pollForCodexReview({ owner: "test", repo: "repo", pr: "1" });

    expect(result).toEqual({
      found: false,
      reviews: [],
      comments: [],
      error: "GITHUB_TOKEN not set",
    });
  });

  it("returns found:false after exhausting all polls with no Codex activity", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
      headers: new Headers(),
    });

    const { pollForCodexReview } = await import("../src/codex-poll.js");

    vi.useFakeTimers();

    const pollPromise = pollForCodexReview({ owner: "test", repo: "repo", pr: "1" });

    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    const result = await pollPromise;

    expect(result).toEqual({
      found: false,
      reviews: [],
      comments: [],
      error: "No Codex review found after 8 minutes",
    });
  });

  it("returns found:true with reviews when Codex review is found", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    const codexReview = {
      id: 42,
      state: "commented",
      body: "Looks good",
      user: { login: "codex-bot" },
    };

    // First call returns reviews, second call returns comments
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([codexReview]),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

    const { pollForCodexReview } = await import("../src/codex-poll.js");

    const result = await pollForCodexReview({ owner: "test", repo: "repo", pr: "1" });

    expect(result).toEqual({
      found: true,
      reviews: [{ id: 42, state: "commented", body: "Looks good", user: "codex-bot" }],
      comments: [],
    });
  });
});
