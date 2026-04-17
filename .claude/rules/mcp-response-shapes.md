---
paths:
  - "src/mcp/**/*.ts"
  - "src/reports/**/*.ts"
  - "src/output/**/*.ts"
  - "src/review/**/*.ts"
  - "src/types/violation.ts"
  - "src/types/review.ts"
  - "src/engine/scanner.ts"
---

# MCP response shapes — AI-first consumer doctrine

When editing MCP tool handlers, report assemblers, or output formatters, the AI-first consumer model is load-bearing: the primary consumer is an agent, not a human dashboard, and several tooling defaults invert under that framing.

Full doctrine with rationale and worked examples:

@../../docs/kb/architecture/ai-first-consumer.md

Shortlist of the rules that fire most often in these paths:

- Surface, don't suppress. No labeled buckets, no heuristic suppression, no numeric-threshold gates.
- Verbose `meta` is scan-confidence signal — don't trim it to look terse.
- Optional fields: present-when-meaningful (conditional spread), never sentinel-empty (`""`, `null`-as-unknown).
- Zero-output success needs a `warnings: string[]` with a structured code, otherwise it reads as "clean scan" when it may be "tool never ran."
- Headline counters must count one kind of thing; split composites rather than summing categorically different sub-buckets.
- Before adding in-tool analysis the agent could do with Read + Grep, ask whether the tool should just point at the file.
- Before adding a new tool shape in response to feedback, check whether an existing tool already covers the capability.
