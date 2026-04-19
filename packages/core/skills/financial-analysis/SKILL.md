---
name: financial-analysis
description: Methodology for financial analysis and forecasting, applicable to small-scale F&B/retail projects
---

# Financial Analysis Methodology

## Core Principles

**Estimate revenue conservatively, estimate costs generously.** The greatest risk in a business plan is optimism bias.

## Cost Analysis Framework

### One-Time Costs (CAPEX)

| Category | Typical Share | Commonly Overlooked Items |
|----------|--------------|--------------------------|
| Renovation | 40-60% | Fire safety approval fees, design fees |
| Equipment | 20-30% | Installation/commissioning fees, spare parts |
| Licenses | 5-10% | Rent during the waiting period for permits |
| Contingency | 10-15% | **Must be reserved**, cannot be omitted |

### Recurring Costs (OPEX)

Monthly fixed cost checklist (do not omit):
- Rent + property management fees + utilities
- Labor (including social insurance, not just wages)
- Raw materials/supplies
- Waste/spoilage (food spoilage rate typically 5-10%)
- Marketing expenses
- Maintenance and repairs
- Taxes (VAT, income tax)
- Loan interest (if applicable)

## Revenue Forecasting

Use **Conservative-Baseline-Optimistic** three-tier forecasting:

```
Conservative = Baseline × 0.7
Optimistic = Baseline × 1.3
```

Key variables:
- **Daily foot traffic**: Estimate weekdays and weekends separately
- **Average ticket size**: Weighted by product mix, do not use the highest price
- **Table turnover rate**: Do not exceed the industry average for similar store types
- **Ramp-up period**: New stores typically operate at 50-70% of mature-stage levels for the first 3-6 months

## Artifact Recording

```bash
# Cost item recording
wanman artifact put --kind budget_item --path "costs/monthly/rent" \
  --meta '{"source":"web_search:58.com","confidence":0.6,"amount":15000,"currency":"CNY","period":"monthly","category":"fixed","notes":"30 sqm, street-level commercial unit"}'

# Revenue forecast recording
wanman artifact put --kind revenue_forecast --path "revenue/daily/baseline" \
  --meta '{"source":"estimate","confidence":0.35,"daily_customers":80,"avg_ticket":32,"daily_revenue":2560,"basis":"nearby similar stores foot traffic × 0.7"}'
```

## Key Metrics

- **Payback period**: Small F&B typically 12-24 months; be cautious if exceeding 30 months
- **Gross margin**: Coffee 65-75%, light meals 50-60%, beverages 60-70%
- **Revenue per employee**: Monthly revenue / headcount; optimize if below 15,000
- **Revenue per sqm**: Monthly revenue / area (sqm); benchmark against same category in same area
