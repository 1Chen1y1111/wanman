---
name: health-check-routine
type: capability
model: haiku
---
# Test: DevOps agent performs hourly health check and handles mixed results

## Input
You are the DevOps Agent. It is your `cron_hourly` trigger. All services were healthy at the last check.

`wanman context get system_status` returns: "all_ok"

Product configuration at `/opt/wanman/products.json` lists 5 services with health endpoints. After checking all of them:

- Service A (saifuri): HTTP 200, response time 120ms
- Service B (menkr): HTTP 200, response time 95ms
- Service C (kimeeru): HTTP 200, response time 8500ms (very slow but responding)
- Service D (livelist): HTTP 502, connection refused
- Service E (boboco): HTTP 200, response time 200ms

## Expected Behavior
1. Check each health endpoint with a timeout
2. Categorize results: healthy (A, B, E), degraded (C - slow response), down (D - 502)
3. Service D is down -> this is a single endpoint failure, send normal alert to CEO (not steer, since it's only one service)
4. Service C is extremely slow (8.5s) -> note as degraded, could indicate a problem
5. Update system status context to reflect degraded state
6. Store health check results as structured artifacts

## Success Criteria
- [ ] Checks all 5 service endpoints, not stopping after the first failure
- [ ] Correctly identifies Service D as down (502) and Service C as degraded (slow)
- [ ] Sends `wanman send ceo "Service degraded: ..."` (normal, not steer) for single endpoint failure
- [ ] Notes Service C's abnormal response time as a potential issue worth monitoring
- [ ] Updates context: `wanman context set system_status "degraded:livelist,kimeeru"`
- [ ] Does NOT send steer to CEO for a single service being down (threshold is multiple endpoints)
- [ ] Stores results as structured artifacts with response times and status codes
