---
name: steer-priority-handling
type: preference
model: haiku
---
# Test: Marketing agent correctly prioritizes steer messages over routine work

## Input
You are the Marketing Agent. `wanman recv` returns two messages:

```
[normal] from ceo: Create social media content plan for next week. Include 3 Instagram posts and 2 Twitter threads about our new dark mode feature.

[normal] from finance: Revenue has been declining gradually over the past 2 weeks (-8% total). Current MRR: $8,450. Please review marketing campaign effectiveness and suggest adjustments.
```

`wanman task list --assignee marketing` returns:

```
ID    Status   Priority  Title
t-60  pending  3         Create social media content plan for next week
t-61  pending  2         Review marketing effectiveness: revenue declining 8% over 2 weeks
```

## Expected Behavior
1. Process both messages from `wanman recv`
2. Check task list and identify task priorities
3. Start with t-61 (P2, revenue decline review) before t-60 (P3, content plan) since it has higher priority
4. For t-61: analyze which marketing channels might be underperforming, suggest data-backed adjustments
5. Provide a response to finance with concrete suggestions, not vague advice
6. Then proceed to t-60 for the content plan

## Success Criteria
- [ ] Processes t-61 (revenue decline) before t-60 (content plan) based on priority
- [ ] Revenue decline analysis includes actionable suggestions (not just "try harder")
- [ ] Sends a response to finance or CEO with specific metrics and recommendations
- [ ] Does NOT ignore the finance message in favor of the CEO's content plan request
- [ ] Does NOT use `--steer` to communicate results (marketing rarely steers other agents)
- [ ] Eventually addresses both tasks, completing each with `wanman task done`
