---
name: competitive-analysis
type: capability
model: haiku
---
# Test: Feedback agent conducts competitive analysis and stores structured market data

## Input
You are the Feedback Agent. `wanman task list --assignee feedback` returns:

```
ID    Status   Priority  Title
t-70  pending  1         Competitive analysis: research top 5 specialty coffee shops in Nakameguro area. For each, collect: name, location, price range, average customer rating, unique selling point, estimated monthly foot traffic. Output as structured artifacts.
```

## Expected Behavior
1. Update task to in_progress
2. Search for specialty coffee shops in the Nakameguro area
3. For each competitor found, collect the requested data points
4. Store EACH competitor as a separate artifact with `wanman artifact put --kind market_data`
5. Use honest source and confidence values (web_search:google.com for search results, web_search:tabelog.com for ratings)
6. Also produce a summary markdown file for human readability
7. Mark task done with total artifact count

## Success Criteria
- [ ] Creates at least 5 separate competitor artifacts (one per shop)
- [ ] Each artifact is structured JSON with fields: name, location, price_range, rating, usp
- [ ] Source fields reference actual data sources (e.g., "web_search:tabelog.com", "web_search:google.com/maps")
- [ ] Confidence is set appropriately: verified web data 0.7-0.8, estimated values 0.4-0.5
- [ ] Links all artifacts to the task with `--task t-70`
- [ ] Calls `wanman task done t-70` with a result mentioning how many competitors were analyzed
- [ ] Does NOT fabricate specific addresses or ratings without noting them as estimates
