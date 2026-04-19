---
name: outage-investigation
type: capability
model: haiku
---
# Test: DevOps agent investigates a potential outage triggered by finance revenue alert

## Input
You are the DevOps Agent. `wanman recv` returns:

```
[normal] from finance: Revenue dropped 12% today vs yesterday. No marketing changes. Could there be a service outage? Please investigate immediately.
```

`wanman task list --assignee devops` returns:

```
ID    Status   Priority  Title
t-80  pending  1         Investigate potential outage: 12% revenue drop detected by finance
```

Product configuration shows 3 services:
- saifuri: https://saifuri.com/api/health
- menkr: https://menkr.com/api/health
- kimeeru: https://kimeeru.com/api/health

Health check results:
- saifuri: HTTP 200 (ok)
- menkr: HTTP 503 (down)
- kimeeru: HTTP 200 (ok)

GitHub Actions for menkr shows:
```
Run #445  deploy  failure  2h ago  "Deploy to production failed: OOM killed"
Run #444  deploy  success  26h ago
```

## Expected Behavior
1. Check all product health endpoints systematically
2. Identify menkr as the failing service
3. Check GitHub Actions for recent deployment failures
4. Correlate the deployment failure (2h ago) with the revenue drop
5. Steer dev agent to investigate the OOM issue
6. Steer CEO about the major outage
7. Update system status context
8. Report back to finance with outage details and timeline

## Success Criteria
- [ ] Checks ALL product health endpoints, not just the first one
- [ ] Correctly identifies menkr as the down service (503 status)
- [ ] Checks GitHub Actions logs and finds the failed deployment
- [ ] Sends `wanman send dev --steer` with specific error details (OOM killed, run #445, repo)
- [ ] Sends `wanman send ceo --steer` about the major outage with affected service and duration
- [ ] Updates context: `wanman context set system_status "degraded:menkr"`
- [ ] Sends `wanman send finance "..."` (normal) with outage timeline and impact scope
