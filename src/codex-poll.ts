export interface CodexPollOptions {
  owner: string;
  repo: string;
  pr: string;
}

/** Fetch all pages from a GitHub API list endpoint. */
async function fetchAllPages(url: string, headers: Record<string, string>): Promise<any[]> {
  const results: any[] = [];
  let nextUrl: string | null = `${url}${url.includes("?") ? "&" : "?"}per_page=100`;

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    const page: any[] = await res.json() as any[];
    results.push(...page);

    // Parse Link header for next page
    const link: string | null = res.headers.get("link");
    const next: RegExpMatchArray | null | undefined = link?.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = next ? next[1] : null;
  }

  return results;
}

function isCodexActivity(item: any): boolean {
  return (
    item.user?.login?.toLowerCase().includes("codex") ||
    item.performed_via_github_app?.slug?.toLowerCase().includes("codex")
  );
}

export async function pollForCodexReview(opts: CodexPollOptions): Promise<void> {
  const { owner, repo, pr } = opts;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(JSON.stringify({ found: false, error: "GITHUB_TOKEN not set" }));
    process.exit(1);
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
      const reviews = await fetchAllPages(reviewsUrl, headers);

      const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/comments`;
      const comments = await fetchAllPages(commentsUrl, headers);

      const codexReviews = reviews.filter(isCodexActivity);
      const codexComments = comments.filter(isCodexActivity);

      if (codexReviews.length > 0 || codexComments.length > 0) {
        const result = {
          found: true,
          reviews: codexReviews.map((r: any) => ({ id: r.id, state: r.state, body: r.body, user: r.user?.login })),
          comments: codexComments.map((c: any) => ({ id: c.id, body: c.body, path: c.path, user: c.user?.login })),
        };
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      }
    } catch (err) {
      console.error(`[forge] Poll attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(JSON.stringify({ found: false, error: "No Codex review found after 8 minutes" }));
  process.exit(1);
}
