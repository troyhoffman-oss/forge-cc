export interface CodexPollOptions {
  owner: string;
  repo: string;
  pr: string;
}

export interface GitHubReview {
  id: number;
  state: string;
  body: string;
  user?: { login: string };
  performed_via_github_app?: { slug: string };
}

export interface GitHubComment {
  id: number;
  body: string;
  path?: string;
  user?: { login: string };
  performed_via_github_app?: { slug: string };
}

/** Known Codex bot login names. */
const CODEX_LOGINS = ["codex-bot", "github-codex", "codex"];

/** Fetch all pages from a GitHub API list endpoint. */
export async function fetchAllPages<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = `${url}${url.includes("?") ? "&" : "?"}per_page=100`;

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    const page = await res.json() as T[];
    results.push(...page);

    // Parse Link header for next page
    const link: string | null = res.headers.get("link");
    const next: RegExpMatchArray | null | undefined = link?.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = next ? next[1] : null;
  }

  return results;
}

export function isCodexActivity(item: { user?: { login: string }; performed_via_github_app?: { slug: string } }): boolean {
  const login = item.user?.login?.toLowerCase();
  if (login && CODEX_LOGINS.includes(login)) return true;
  return item.performed_via_github_app?.slug === "codex";
}

export interface CodexPollResult {
  found: boolean;
  reviews: Array<{ id: number; state: string; body: string; user?: string }>;
  comments: Array<{ id: number; body: string; path?: string; user?: string }>;
  error?: string;
}

export async function pollForCodexReview(opts: CodexPollOptions): Promise<CodexPollResult> {
  const { owner, repo, pr } = opts;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { found: false, reviews: [], comments: [], error: "GITHUB_TOKEN not set" };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const maxPolls = 8;
  const pollInterval = 60_000; // 60 seconds

  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    console.error(`[forge] Polling for Codex review (attempt ${i + 1}/${maxPolls})...`);

    try {
      const reviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/reviews`;
      const reviews = await fetchAllPages<GitHubReview>(reviewsUrl, headers);

      const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/comments`;
      const comments = await fetchAllPages<GitHubComment>(commentsUrl, headers);

      const codexReviews = reviews.filter(isCodexActivity);
      const codexComments = comments.filter(isCodexActivity);

      if (codexReviews.length > 0 || codexComments.length > 0) {
        return {
          found: true,
          reviews: codexReviews.map((r) => ({ id: r.id, state: r.state, body: r.body, user: r.user?.login })),
          comments: codexComments.map((c) => ({ id: c.id, body: c.body, path: c.path, user: c.user?.login })),
        };
      }
    } catch (err) {
      console.error(`[forge] Poll attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { found: false, reviews: [], comments: [], error: "No Codex review found after 8 minutes" };
}
