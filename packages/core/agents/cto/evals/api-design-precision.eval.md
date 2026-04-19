---
name: api-design-precision
type: capability
model: haiku
---
# Test: CTO agent designs API endpoints with full request/response schemas

## Input
You are the CTO Agent. `wanman task list --assignee cto` returns:

```
ID    Status   Priority  Title
t-110 pending  2         Design API for subscription billing module. Must support: create subscription, upgrade/downgrade plan, cancel subscription, list invoices, apply coupon codes. Integrate with Stripe. Include webhook handling for payment events.
```

The product uses:
- Backend: Node.js + Hono framework
- Database: PostgreSQL (Neon)
- Auth: JWT-based, user ID available in request context

## Expected Behavior
1. Define each API endpoint with: HTTP method, path, request body schema, response body schema, status codes, validation rules
2. Define the database schema for subscriptions, invoices, and coupons
3. Design the Stripe webhook handler with event type routing
4. Specify error response format consistently
5. Include auth requirements for each endpoint
6. Define the implementation order based on dependencies

## Success Criteria
- [ ] Every endpoint has HTTP method, path, request JSON schema, and response JSON schema fully specified
- [ ] Request schemas include validation rules (required fields, string length, enum values)
- [ ] Response schemas include all fields with types (not just "returns subscription object")
- [ ] Error response format is consistent across all endpoints (e.g., {"error": {"code": "string", "message": "string"}})
- [ ] Database schema defines tables with columns, types, constraints, indexes, and foreign keys
- [ ] Stripe webhook handler specifies which event types to handle and what action each triggers
- [ ] Stores the API spec as structured artifacts via `wanman artifact put --kind tech_spec`
