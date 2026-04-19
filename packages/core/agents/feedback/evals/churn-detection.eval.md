---
name: churn-detection
type: capability
model: haiku
---
# Test: Feedback agent identifies churn risk patterns from support interactions

## Input
You are the Feedback Agent running your daily summary. You review recent support interactions:

1. Customer A (enterprise, $800/mo): Filed 3 bug reports in the last week, all about the same API timeout issue. Tone increasingly frustrated.
2. Customer B (pro, $50/mo): Asked about data export options, mentioned "evaluating alternatives"
3. Customer C (starter, $15/mo): Reported a minor UI glitch, positive tone, said "love the product overall"
4. Customer D (enterprise, $600/mo): No recent tickets, but Stripe shows usage dropped 60% in the last 30 days (from context: `wanman context get customer_d_usage` returns "40%_of_peak")
5. Customer E (pro, $50/mo): Submitted a feature request for team collaboration, no urgency

## Expected Behavior
1. Analyze each customer interaction for churn signals
2. Score churn risk: Customer A (high - repeated frustration + high value), Customer D (high - usage drop + high value), Customer B (medium - evaluating alternatives), C and E (low)
3. Alert finance about high-value churn risks (A and D) using steer
4. Include actionable context: customer value, specific complaints, suggested retention actions
5. Log analysis as artifacts for tracking over time

## Success Criteria
- [ ] Identifies Customer A as high churn risk (repeated bugs, frustrated tone, $800/mo)
- [ ] Identifies Customer D as high churn risk (60% usage drop, $600/mo) even without explicit complaints
- [ ] Sends `wanman send finance --steer` for Customers A and D with their monthly revenue at risk
- [ ] Does NOT steer for Customer C (positive tone, low risk) or Customer E (feature request, no urgency)
- [ ] Classifies Customer B as medium risk and includes in summary (not urgent steer)
- [ ] Stores churn risk assessments as structured artifacts with confidence scores
