# Codex Review Protocol

After a PR is created, poll for Codex auto-review comments, evaluate them, fix valid issues, and return to the user for merge approval.

**The agent must NEVER auto-merge a PR.** Always return to the user for merge approval.

---

## Step 1 — Check Prerequisites

Before polling, verify:
- `GITHUB_TOKEN` is set in the environment
- A PR was actually created in the previous step (you have the PR URL and number)

**If `GITHUB_TOKEN` is not set:** Skip this protocol entirely. Print: "Skipping Codex review — GITHUB_TOKEN not set." Proceed to the skill's summary step.

Extract the owner, repo, and PR number from the PR URL:
```
# Example: https://github.com/troyhoffman-oss/forge-cc/pull/30
# owner=troyhoffman-oss, repo=forge-cc, pr=30
```

---

## Step 2 — Poll for Review

Run the Codex poll CLI command:

```bash
npx forge codex-poll --owner {owner} --repo {repo} --pr {pr_number}
```

This polls every 60 seconds for up to 8 minutes. The command outputs JSON:

**If Codex review found** (exit code 0):
```json
{
  "found": true,
  "reviews": [{ "id": 123, "state": "commented", "body": "...", "user": "codex-bot" }],
  "comments": [{ "id": 456, "body": "...", "path": "src/foo.ts", "user": "codex-bot" }]
}
```

**If no review found** (exit code 1):
```json
{
  "found": false,
  "error": "No Codex review found after 8 minutes"
}
```

**If no review found:** This is not a failure. Print: "No Codex review received. Proceeding." Continue to the skill's summary step.

---

## Step 3 — Evaluate Comments

For each comment in the poll result, evaluate whether the feedback is valid:

1. **Read the code** at the file path referenced in the comment (`path` field)
2. **Understand the suggestion** — what is Codex recommending?
3. **Assess validity** using your judgment. Categorize each comment as:

| Category | Meaning | Action |
|----------|---------|--------|
| **Valid** | The feedback identifies a real issue worth fixing | Fix the code |
| **Acknowledged** | The feedback is reasonable but a fix isn't appropriate (by design, out of scope, or would introduce other issues) | Reply explaining why |
| **Dismissed** | The feedback is incorrect or not applicable | Reply explaining why |

**Evaluation guidelines:**
- Security issues are almost always valid
- Performance suggestions are valid if the impact is meaningful
- Style preferences that contradict the project's existing conventions should be dismissed
- Suggestions that would break existing tests or APIs should be carefully evaluated

---

## Step 4 — Fix Valid Issues

For each comment categorized as **Valid**:

1. Make the code change in the current branch
2. Run verification to ensure the fix doesn't break anything:
   ```bash
   npx forge verify
   ```
3. If verification fails, fix the verification issue before proceeding
4. Stage and commit the fix:
   ```bash
   git add {changed files}
   git commit -m "Address Codex review: {brief description of fix}"
   ```

After all valid fixes are committed:
```bash
git push
```

---

## Step 5 — Reply and Resolve

For **each** Codex comment, reply on GitHub with what was done:

**For valid (fixed) comments:**
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  -F body="Fixed — {brief description of what was changed}. {commit SHA}" \
  -F in_reply_to={comment_id}
```

**For acknowledged comments:**
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  -F body="Acknowledged — {reason this wasn't fixed}." \
  -F in_reply_to={comment_id}
```

**For dismissed comments:**
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  -F body="Dismissed — {reason this doesn't apply}." \
  -F in_reply_to={comment_id}
```

---

## Step 6 — Return to User

After all comments are addressed, present a summary and ask for merge approval:

```
## Codex Review Summary

**Comments found:** {total count}
- Fixed: {count}
- Acknowledged: {count}
- Dismissed: {count}

{For each comment, one line:}
- [{Valid/Acknowledged/Dismissed}] {file path}: {brief description}
```

Then ask:

<AskUserQuestion>
question: "Codex review comments have been addressed. Ready to merge?"
options:
  - "Merge the PR"
  - "I want to review the changes first"
  - "Don't merge — I'll handle it"
</AskUserQuestion>

**If "Merge the PR":** Merge using `gh pr merge {pr_number} --squash --delete-branch`

**If "I want to review first":** Print the PR URL and stop. Let the user review manually.

**If "Don't merge":** Print the PR URL and stop. Do not merge.
