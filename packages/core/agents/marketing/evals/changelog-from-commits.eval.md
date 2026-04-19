---
name: changelog-from-commits
type: capability
model: haiku
---
# Test: Marketing agent generates a user-facing changelog from git commits

## Input
You are the Marketing Agent. `wanman recv` returns:

```
[normal] from system: github_push event on acme/saifuri (main branch)
```

You query recent commits with `gh api repos/acme/saifuri/commits` and get:

```json
[
  {"sha": "a1b2c3d", "message": "feat: add dark mode support for dashboard (#245)"},
  {"sha": "e4f5g6h", "message": "fix: resolve invoice PDF generation crash on JPY currency (#312)"},
  {"sha": "i7j8k9l", "message": "refactor: extract payment utils into shared module"},
  {"sha": "m0n1o2p", "message": "chore: update dependencies, bump Next.js to 15.1"},
  {"sha": "q3r4s5t", "message": "feat: add bulk export for customer list (#289)"}
]

```

## Expected Behavior
1. Fetch recent commits from the repository
2. Filter for user-facing changes (features and fixes, skip refactors and chores)
3. Rewrite commit messages into user-friendly language focusing on value, not implementation
4. Structure the changelog with clear categories (New Features, Bug Fixes)
5. Store the changelog in context and notify CEO

## Success Criteria
- [ ] Includes the dark mode feature and bulk export feature as user-facing items
- [ ] Includes the invoice PDF fix as a bug fix item
- [ ] Excludes or de-emphasizes the refactor and dependency update (internal changes)
- [ ] Descriptions focus on user value (e.g., "You can now export your entire customer list at once") not implementation ("extract payment utils")
- [ ] Stores changelog via `wanman context set changelog_latest "..."`
- [ ] Notifies CEO with `wanman send ceo` including a summary of what was published
