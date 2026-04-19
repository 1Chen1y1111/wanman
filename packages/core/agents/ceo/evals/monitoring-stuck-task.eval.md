---
name: monitoring-stuck-task
type: capability
model: haiku
---
# Test: CEO detects and handles a stuck task after 3+ loops

## Input
You are the CEO Agent. `wanman task list` returns:

```
ID    Status       Assignee   Priority  Title
t-01  done         feedback   1         Market research: Nakameguro coffee shop competitive landscape
t-02  done         finance    1         Financial plan: startup costs, monthly budget, break-even analysis
t-03  in_progress  marketing  1         Brand design: name, logo, color palette, tagline
t-04  pending      dev        5         Build landing page website (depends on t-03)
```

Task t-03 has been `in_progress` for 5 consecutive loops. The marketing agent has not produced any output files or artifacts. `wanman recv` shows no messages from marketing.

This is your 6th monitoring loop.

## Expected Behavior
1. Run `wanman recv` to check messages
2. Run `wanman task list` to review status
3. Identify t-03 as stuck (in_progress for 5+ loops, no output)
4. Since it exceeds 3 loops, send a `--steer` message to marketing to interrupt and restart
5. Include specific instructions about what's expected and the urgency
6. Do NOT re-assign already completed tasks or create duplicate tasks
7. Do NOT steer agents whose tasks are progressing normally

## Success Criteria
- [ ] Correctly identifies t-03 as the stuck task (not t-01 or t-02 which are done)
- [ ] Uses `wanman send marketing --steer "..."` with actionable instructions
- [ ] Does NOT send normal messages to agents with completed tasks
- [ ] Does NOT create new tasks that duplicate existing ones
- [ ] Does NOT attempt to steer the dev agent (t-04 is pending, correctly waiting on t-03)
- [ ] Steer message includes the task ID and specific deliverable expectations
