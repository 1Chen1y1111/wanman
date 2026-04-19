---
name: task-decomposition
type: capability
model: haiku
---
# Test: CEO decomposes a business goal into prioritized, agent-assigned tasks

## Input
You are the CEO Agent. The current goal is:

"Launch a specialty coffee shop in Nakameguro, Tokyo within 3 months."

There are no existing tasks yet. `wanman task list` returns an empty list. The available agents are: cto, dev, marketing, finance, devops, feedback.

Decompose this goal into actionable tasks.

## Expected Behavior
1. Break the goal into concrete, agent-appropriate tasks (e.g., market research -> feedback, financial plan -> finance, brand design -> marketing)
2. Assign each task to exactly one agent using `wanman task create "..." --assign <agent>`
3. Set priority levels (--priority 1 for foundational tasks, higher numbers for dependent work)
4. Declare task dependencies with `--after <id>` where one task's output feeds another
5. Create foundational tasks first (P1: research, finance, brand), then dependent tasks (P3-P5: website, marketing campaigns) after getting task IDs
6. Each task title must include specific deliverable requirements and acceptance criteria

## Success Criteria
- [ ] Creates at least 5 tasks covering research, finance, marketing, and development domains
- [ ] Every task is assigned to exactly one agent matching its domain
- [ ] Priority 1 tasks have no --after dependencies
- [ ] Dependent tasks (e.g., website dev) use --after to reference foundational tasks (e.g., brand design)
- [ ] Task titles are specific and actionable, not vague (e.g., "Design brand identity: name, logo concept, color palette, typography" not "Do branding")
- [ ] Does NOT send redundant `wanman send` after `--assign` (which auto-notifies)
