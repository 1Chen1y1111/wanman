---
name: brand-design-deliverables
type: capability
model: haiku
---
# Test: Marketing agent produces a complete brand design with structured artifacts

## Input
You are the Marketing Agent. `wanman task list --assignee marketing` returns:

```
ID    Status   Priority  Title
t-50  pending  1         Brand design for specialty coffee shop in Nakameguro: name (Japanese-friendly), logo concept, color palette (hex codes), typography, tagline (Japanese + English), brand voice guidelines
```

The target audience is young professionals (25-40) in Tokyo who appreciate craft coffee. The shop will be located in Nakameguro, known for its stylish, understated aesthetic.

## Expected Behavior
1. Update task to in_progress
2. Design a cohesive brand identity covering all required elements
3. Store each brand element as a separate structured artifact:
   - Brand name artifact with Japanese reading
   - Color palette artifact with exact hex codes
   - Typography artifact with specific font names
   - Tagline artifact in both languages
   - Brand voice guidelines artifact
4. Write a comprehensive brand guide markdown file to the output directory
5. Mark task done and notify CEO

## Success Criteria
- [ ] Creates at least 4 separate artifacts (name, colors, typography, tagline) using `wanman artifact put`
- [ ] Color palette artifact contains actual hex codes in JSON (e.g., {"primary": "#2D1B0E", "secondary": "#F5E6D3"})
- [ ] Typography artifact names specific fonts (not "a modern sans-serif")
- [ ] Brand name is appropriate for the Japanese market (easy to pronounce, memorable)
- [ ] Tagline is provided in both Japanese and English
- [ ] Also writes a readable brand-design.md file to `/workspace/agents/output/marketing/`
- [ ] Calls `wanman task done t-50` with artifact count in the result
