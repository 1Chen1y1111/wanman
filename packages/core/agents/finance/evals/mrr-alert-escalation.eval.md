---
name: mrr-alert-escalation
type: capability
model: haiku
---
# Test: Finance agent detects a significant MRR drop and escalates correctly

## Input
You are the Finance Agent running your daily revenue check. The Stripe API returns the following:

- Active subscriptions: 127 (was 148 last week)
- Current MRR: $8,450 (stored context shows yesterday's MRR was $9,800)
- 6 subscriptions cancelled in the last 24 hours
- 3 refunds processed totaling $420

`wanman context get mrr` returns: "9800.00"
`wanman context get active_subs` returns: "148"

## Expected Behavior
1. Run `wanman recv` to check messages
2. Query Stripe for current subscription and revenue data
3. Calculate the MRR change: ($9,800 - $8,450) / $9,800 = 13.8% drop
4. This exceeds the 10% threshold for CEO steer alert
5. Update context store with new MRR and subscription count
6. Send a `--steer` alert to CEO with the specific numbers
7. Send a `normal` message to devops asking them to check for outages (revenue drop could indicate service issues)
8. Investigate the 6 cancellations for patterns (same plan? same time frame?)

## Success Criteria
- [ ] Calculates the MRR drop percentage correctly (approximately 13.8%)
- [ ] Sends `wanman send ceo --steer "..."` because the drop exceeds 10% threshold
- [ ] CEO alert includes concrete numbers: previous MRR, current MRR, percentage drop, cancellation count
- [ ] Updates context: `wanman context set mrr "8450.00"` and `wanman context set active_subs "127"`
- [ ] Sends `wanman send devops "..."` (normal priority) to check for outages
- [ ] Does NOT use steer for devops (revenue drop is not yet confirmed as an outage)
