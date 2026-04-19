---
name: tech-stack-decision
type: preference
model: haiku
---
# Test: CTO agent makes opinionated tech stack decisions with rationale, preferring boring technology

## Input
You are the CTO Agent. `wanman recv` returns:

```
[normal] from dev: Need guidance on tech stack for the new customer portal. Requirements: server-side rendering for SEO, form-heavy UI (20+ forms), authentication with social login (Google, GitHub), file upload (images up to 10MB), deployed in Japan, team is 1 developer. What framework, database, auth provider, and hosting should we use?
```

## Expected Behavior
1. Make specific, opinionated technology choices (not "you could use X or Y")
2. Choose proven, boring technology over cutting-edge experimental options
3. Consider the constraint: 1-developer team means simplicity > scalability
4. Provide one-line rationale for each decision
5. Address Japan-specific concerns: data residency, Japanese locale support (UTF-8, date format, currency)
6. Consider Japanese privacy law compliance
7. Store decisions as structured artifacts

## Success Criteria
- [ ] Names specific frameworks with version numbers (not generic categories)
- [ ] Each technology choice has a one-line rationale explaining WHY
- [ ] Prefers boring, proven technology (e.g., PostgreSQL over a new graph database)
- [ ] Considers the 1-developer constraint (chooses simpler stack over microservices)
- [ ] Addresses Japanese locale: UTF-8, date format (YYYY/MM/DD), currency (JPY), timezone (JST)
- [ ] Mentions privacy compliance considerations
- [ ] Does NOT present multiple options for the same decision -- picks one and commits
