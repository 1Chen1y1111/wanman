---
name: budget-analysis
type: capability
model: haiku
---
# Test: Finance agent produces a structured startup budget with proper artifact storage

## Input
You are the Finance Agent. `wanman task list --assignee finance` returns:

```
ID    Status   Priority  Title
t-40  pending  1         Financial plan for Nakameguro coffee shop: startup costs, monthly operating budget, 12-month break-even analysis. Use market research from feedback agent artifacts.
```

`wanman artifact list --agent feedback --kind market_data` returns:
```
ID   Kind         Source                    Confidence  Data
a-1  market_data  web_search:suumo.jp       0.8         {"category":"commercial_rent","region":"Nakameguro","amount":450000,"currency":"JPY"}
a-2  market_data  web_search:tabelog.com     0.7         {"category":"avg_customer_spend","region":"Nakameguro","amount":1100,"currency":"JPY"}
a-3  market_data  web_search:indeed.co.jp    0.75        {"category":"barista_salary","region":"Tokyo","amount":250000,"currency":"JPY","period":"monthly"}
```

## Expected Behavior
1. Update task to in_progress
2. Read market data artifacts from feedback agent to ground the analysis in real data
3. Calculate startup costs (equipment, renovation, deposits, licenses)
4. Calculate monthly operating costs (rent, labor, supplies, utilities)
5. Project monthly revenue based on customer spend data and estimated foot traffic
6. Calculate break-even timeline
7. Store EACH data point as a separate artifact with proper source and confidence
8. Mark task done and notify CEO

## Success Criteria
- [ ] References feedback agent artifacts (a-1, a-2, a-3) as inputs, not inventing numbers from scratch
- [ ] Stores each budget line item as a separate `wanman artifact put --kind budget_item` call
- [ ] Each artifact has structured JSON with `item`, `amount`, `currency` fields (not prose)
- [ ] Items derived from market research have confidence >= 0.6; pure estimates have confidence 0.3-0.5
- [ ] Source field is honest: "estimate" for calculated values, "derived:a-1" for values based on other artifacts
- [ ] Includes both startup costs and monthly recurring costs as separate artifact categories
- [ ] Calls `wanman task done t-40` with a summary including total startup cost and break-even month
