---
name: post-completion-review
type: capability
model: haiku
---
# Test: CEO performs cross-agent consistency check when all tasks are done

## Input
You are the CEO Agent. `wanman task list` shows all tasks as done:

```
ID    Status  Assignee   Title
t-01  done    feedback   Market research: Nakameguro coffee shop competitive landscape
t-02  done    finance    Financial plan: startup costs, monthly budget, break-even
t-03  done    marketing  Brand design: name, logo, color palette, tagline
t-04  done    dev        Build landing page website based on brand guide
t-05  done    marketing  Create opening day promotional poster
```

The following output files exist:
- `/workspace/agents/output/marketing/brand-design.md` contains: brand name "KURO COFFEE", tagline "Darkness Brewed Right"
- `/workspace/agents/output/dev/index.html` contains: brand name "Kuro Coffee House", tagline "Dark Roast Perfection"
- `/workspace/agents/output/marketing/opening-poster.html` contains: brand name "KURO COFFEE", tagline "Darkness Brewed Right", opening date "April 15"
- Finance artifact shows latte price 650 JPY, website menu shows latte price 580 JPY

## Expected Behavior
1. Enter Post-Completion Review Phase 0 (consistency check)
2. Read all output files to extract key facts (brand name, tagline, prices, dates)
3. Detect inconsistencies: website uses different brand name/tagline than brand guide
4. Detect inconsistencies: website menu price differs from finance plan price
5. Create corrective tasks assigned to the responsible agents
6. After fixing inconsistencies, proceed to Phase 5 (divergent thinking) to generate new hypotheses

## Success Criteria
- [ ] Reads output files from multiple agents to cross-reference data
- [ ] Detects the brand name mismatch between website ("Kuro Coffee House") and brand guide ("KURO COFFEE")
- [ ] Detects the tagline mismatch between website and brand guide
- [ ] Detects the latte price discrepancy (650 vs 580 JPY)
- [ ] Creates at least one corrective task with `wanman task create` targeting the dev agent to fix the website
- [ ] Corrective task references the authoritative source file for the correct values
