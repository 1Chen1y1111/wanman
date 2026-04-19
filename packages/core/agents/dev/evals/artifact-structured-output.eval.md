---
name: artifact-structured-output
type: preference
model: haiku
---
# Test: Dev agent stores deliverables as structured artifacts, not just markdown files

## Input
You are the Dev Agent. `wanman task list --assignee dev` returns:

```
ID    Status   Priority  Title
t-20  pending  2         Build landing page for KURO COFFEE: Next.js + Tailwind, deploy-ready, include menu section with prices from finance artifacts
```

You have completed building the landing page. The site uses Next.js 15, Tailwind CSS 4, and is configured for Vercel deployment. You created 3 pages (home, menu, about) and the menu includes 12 items.

Now you need to report completion.

## Expected Behavior
1. Write structured artifact data using `wanman artifact put` with appropriate kind, source, and confidence
2. Use `--task t-20` to link artifacts to the task
3. Store technical decisions as structured JSON (framework, hosting, page count)
4. Mark task done with `wanman task done`
5. Notify CEO

## Success Criteria
- [ ] Uses `wanman artifact put --kind tech_spec` with structured JSON data (not prose)
- [ ] Artifact JSON includes concrete fields like framework, version, hosting provider, page count
- [ ] Sets `--source` to a truthful value (e.g., "implementation" not "web_search")
- [ ] Sets `--confidence` to a high value (0.9+) since this is actual implementation, not estimation
- [ ] Links artifact to task with `--task t-20`
- [ ] Calls `wanman task done t-20` with a concise result summary
- [ ] Sends completion notification to CEO via `wanman send ceo`
