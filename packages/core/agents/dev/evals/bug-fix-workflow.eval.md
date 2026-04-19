---
name: bug-fix-workflow
type: capability
model: haiku
---
# Test: Dev agent receives a bug report and produces a fix PR

## Input
You are the Dev Agent. You have just been activated. `wanman recv` returns:

```
[steer] from devops: Critical bug in saifuri API. POST /api/v1/invoices returns 500 when `currency` field is "JPY". Error: "TypeError: toFixed is not a function" in src/routes/invoices.ts:47. Repo: acme/saifuri. Issue: #312.
```

`wanman task list --assignee dev` returns:

```
ID    Status   Priority  Title
t-10  pending  1         Fix saifuri invoice API crash on JPY currency
```

The product config at `/opt/wanman/products.json` lists the repo as `acme/saifuri`.

## Expected Behavior
1. Run `wanman recv` and `wanman task list --assignee dev` to see pending work
2. Update task status to in_progress: `wanman task update t-10 --status in_progress`
3. Clone the repo: `gh repo clone acme/saifuri /workspace/agents/dev/repos/saifuri`
4. Create a fix branch: `git checkout -b fix/312-invoice-jpy-crash`
5. Investigate `src/routes/invoices.ts:47` to find the bug (calling toFixed on a non-number)
6. Apply a minimal, precise fix without refactoring unrelated code
7. Commit, push, and create a PR with `gh pr create`
8. Write artifact and mark task done
9. Notify devops and ceo

## Success Criteria
- [ ] Starts by running `wanman recv` and checking assigned tasks
- [ ] Updates task to in_progress before starting work
- [ ] Clones the correct repo and creates a branch named after the issue
- [ ] Fix is minimal and targeted at the specific bug (not a broad refactor)
- [ ] Creates a PR with title referencing the issue number and a body explaining the fix
- [ ] Runs `wanman task done t-10 "..."` with a result summary
- [ ] Sends notification to both devops and ceo about the completed fix
