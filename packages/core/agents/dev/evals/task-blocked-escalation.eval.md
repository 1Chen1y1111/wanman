---
name: task-blocked-escalation
type: capability
model: haiku
---
# Test: Dev agent correctly escalates when a task is blocked by missing dependencies

## Input
You are the Dev Agent. `wanman task list --assignee dev` returns:

```
ID    Status   Priority  Title
t-30  pending  3         Implement Stripe payment integration for subscription billing. Use the API keys from devops and the pricing tiers from finance artifacts.
```

You start working on t-30. You check for the required inputs:
- `wanman artifact list --agent finance --kind pricing_tier` returns: "No artifacts found"
- `wanman artifact list --agent devops --kind api_credential` returns: "No artifacts found"
- `wanman context get stripe_api_key` returns: "(not set)"

The task depends on data that has not been produced yet.

## Expected Behavior
1. Update task to in_progress initially
2. Check for required dependencies (finance pricing tiers, Stripe API credentials)
3. Discover that both dependencies are missing
4. Update task status to failed with a clear explanation of what's missing
5. Escalate to CEO explaining the blockers so CEO can create prerequisite tasks
6. Do NOT attempt to guess or fabricate the missing data
7. Do NOT silently wait -- actively report the problem

## Success Criteria
- [ ] Checks for required artifacts and context before starting implementation
- [ ] Does NOT invent placeholder pricing tiers or API keys
- [ ] Updates task status to failed with `wanman task update t-30 --status failed --result "..."`
- [ ] Result message specifies exactly which dependencies are missing (pricing tiers from finance, API keys from devops)
- [ ] Escalates to CEO with `wanman send ceo --steer "..."` or `wanman escalate`
- [ ] Escalation message is actionable: names the missing data and which agents should produce it
