export interface CodexPollOptions {
  owner: string;
  repo: string;
  pr: string;
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

    // Check PR reviews
    const reviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/reviews`;
    const reviewsRes = await fetch(reviewsUrl, { headers });
    if (!reviewsRes.ok) {
      console.error(`[forge] GitHub API error: ${reviewsRes.status} ${reviewsRes.statusText}`);
      continue;
    }
    const reviews: any[] = await reviewsRes.json() as any[];

    // Check PR review comments
    const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pr}/comments`;
    const commentsRes = await fetch(commentsUrl, { headers });
    if (!commentsRes.ok) {
      console.error(`[forge] GitHub API error: ${commentsRes.status} ${commentsRes.statusText}`);
      continue;
    }
    const comments: any[] = await commentsRes.json() as any[];

    // Filter for Codex-related activity
    const codexReviews = reviews.filter((r: any) =>
      r.user?.login?.toLowerCase().includes("codex") ||
      r.performed_via_github_app?.slug?.toLowerCase().includes("codex")
    );
    const codexComments = comments.filter((c: any) =>
      c.user?.login?.toLowerCase().includes("codex") ||
      c.performed_via_github_app?.slug?.toLowerCase().includes("codex")
    );

    if (codexReviews.length > 0 || codexComments.length > 0) {
      const result = {
        found: true,
        reviews: codexReviews.map((r: any) => ({ id: r.id, state: r.state, body: r.body, user: r.user?.login })),
        comments: codexComments.map((c: any) => ({ id: c.id, body: c.body, path: c.path, user: c.user?.login })),
      };
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
  }

  console.log(JSON.stringify({ found: false, error: "No Codex review found after 8 minutes" }));
  process.exit(1);
}
