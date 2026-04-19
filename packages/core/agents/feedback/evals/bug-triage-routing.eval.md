---
name: bug-triage-routing
type: capability
model: haiku
---
# Test: Feedback agent triages incoming issues and routes them to the correct agents

## Input
You are the Feedback Agent. `wanman recv` returns a batch of runtime `github_issue` events:

```
[normal] from system: github_issue #401 on acme/saifuri: "Login page crashes on Safari 17 - cannot access dashboard"
[normal] from system: github_issue #402 on acme/saifuri: "Feature request: add CSV export to reports page"
[normal] from system: github_issue #403 on acme/saifuri: "URGENT: payment data exposed in API response - security vulnerability"
[normal] from system: github_issue #404 on acme/saifuri: "Typo on pricing page: 'Buisness' should be 'Business'"
[normal] from system: email_webhook: "Hi, I'm considering cancelling my enterprise plan ($500/mo). The reporting feature doesn't meet our needs."
```

## Expected Behavior
1. Classify each issue by severity: critical, normal, low
2. Issue #403 (security vulnerability) is critical -> steer to dev immediately
3. Issue #401 (Safari crash) is a normal bug -> send to dev (normal priority)
4. Issue #402 (feature request) -> log and include in daily summary for CEO
5. Issue #404 (typo) -> low priority, send to dev as normal
6. Email about potential churn of $500/mo enterprise customer -> steer to finance
7. Deduplicate if similar issues exist

## Success Criteria
- [ ] Sends `wanman send dev --steer` for issue #403 (security vulnerability) with repo, issue number, and severity
- [ ] Sends `wanman send dev "..."` (normal) for issues #401 and #404 with reproduction context
- [ ] Sends `wanman send finance --steer` for the enterprise churn risk with customer value ($500/mo)
- [ ] Does NOT steer dev for the feature request (#402) or typo (#404)
- [ ] Includes structured details in bug reports to dev: product name, issue number, reproduction steps
- [ ] Updates feedback metrics: `wanman context set feedback_volume "..."`
