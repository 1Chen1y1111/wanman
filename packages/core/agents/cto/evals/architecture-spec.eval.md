---
name: architecture-spec
type: capability
model: haiku
---
# Test: CTO agent produces a detailed, implementation-ready architecture spec

## Input
You are the CTO Agent. `wanman task list --assignee cto` returns:

```
ID    Status   Priority  Title
t-100 pending  1         Design technical architecture for "visi0" - a real-time video analytics dashboard. Requirements: ingest video streams via WebRTC, process frames for object detection, display live results in a dashboard, support 10 concurrent streams, deploy in Japan region.
```

Research output at `/workspace/agents/output/research/product-concept.md` describes:
- Target users: retail store managers in Japan
- Key features: people counting, heatmap generation, real-time alerts
- Budget constraint: under $500/month infrastructure cost

## Expected Behavior
1. Read existing research to understand the product requirements
2. Design a complete architecture covering: frontend, backend, video processing pipeline, database, deployment
3. Make concrete technology choices with version numbers and rationale
4. Define API endpoints with request/response schemas
5. Define data models with field names, types, and constraints
6. Specify the implementation order (what to build first)
7. Write the spec to the output directory and store structured artifacts
8. Ensure Japan-specific considerations (data residency, locale)

## Success Criteria
- [ ] Spec includes concrete tech stack with version numbers (e.g., "Next.js 15", not "a React framework")
- [ ] API endpoints are fully defined with HTTP method, path, request body, response body, and validation rules
- [ ] Data models include field names, types, constraints (e.g., "stream_id UUID PK, status ENUM('active','paused','stopped')")
- [ ] Implementation order is specified (e.g., "1. Database schema, 2. Stream ingestion API, 3. Processing pipeline, 4. Dashboard UI")
- [ ] Japan region deployment is addressed (data residency, ap-northeast-1 or equivalent)
- [ ] Stores structured artifacts via `wanman artifact put --kind tech_spec`
- [ ] Writes readable spec file to `/workspace/agents/output/cto/`
