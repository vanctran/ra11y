---
title: "The evaluator-optimizer loop"
topic: pattern
audience: contributors, agents
---

# The evaluator-optimizer loop

Several ra11y workflows use a **generator + critic** loop: one agent produces a candidate, another evaluates it against normative text, feedback goes back into the generator, iterate up to a cap. This page documents the pattern so future additions follow it consistently.

## Why the loop

The generator alone produces plausible-looking but sometimes-wrong output — especially for rule-correctness work where missing a WCAG edge case is a real bug. A critic with narrow scope ("does this rule match the normative text?") catches what the generator missed, without spending context on the whole generation task.

## The canonical instance: `/add-rule`

`/add-rule <criterion-id>` runs the loop:

```
┌─────────────────────────────────────────────────────────┐
│  spec-researcher                                         │
│  Fetches WCAG normative text, summarizes into a         │
│  dense context bundle.                                   │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  rule-implementer  ◀────── feedback (on iteration ≥ 2)  │
│  Generates rule + tests + fixtures + KB entry,          │
│  commits atomically.                                     │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  a11y-reviewer                                           │
│  Compares behavior against the normative text.          │
│  Returns APPROVED or a list of specific issues.          │
└─────────────────────────────────────────────────────────┘
                     │
                APPROVED?
                 /       \
                yes       no → (max 3 iterations)
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  code-reviewer                                           │
│  Independent correctness review of the committed diff.  │
│  Security, logic, type-safety, zero-dep.                 │
└─────────────────────────────────────────────────────────┘
```

Cap: 3 iterations. If the reviewer rejects three times, the skill reports BLOCKED with the reviewer's last feedback and yields.

## Principles

- **Critic is narrow.** The a11y-reviewer's only job is "does behavior match the normative text?" Not "is the code pretty" or "is the test comprehensive" — those are the code-reviewer's job at the end.
- **Feedback is specific.** "Rule doesn't handle the decorative `alt=\"\"` exception" beats "doesn't match the spec." Specific feedback lets the generator act; generic feedback causes thrashing.
- **Cap at 3.** The first iteration is the generation; iterations 2–3 are corrections. If a problem needs more than 3 iterations, the generator doesn't understand the spec — escalate to a human.
- **Commit between agents.** Each specialist commits its own work. The next specialist reviews *real git state*, not an in-memory artifact. Makes failures debuggable.
- **Critic does not write code.** Only the generator writes rule code. The reviewer writes *feedback text* that the generator interprets.

## When to use this pattern

Rule authoring. Criterion interpretation. Any workflow where "plausibility" is cheap but "correctness against a spec" is expensive.

When NOT to use it: deterministic transformations (regenerating KB from metadata, formatting output), pure code review (use `/review` directly), or anything where a single agent's output is already high-confidence.

## Adding a new evaluator-optimizer flow

1. Define the generator — a specialist agent with tight scope.
2. Define the critic — a specialist agent with a narrower scope + a clear APPROVED/ISSUES return format.
3. Define the feedback protocol — structured list of issues the generator can consume.
4. Write a skill that orchestrates the loop with a cap.
5. Test the skill against a known-bad case — confirm the critic catches it and the generator fixes it.

See `.claude/skills/add-rule/SKILL.md` for the reference implementation.

## See also

- `.claude/agents/rule-implementer.md`, `a11y-reviewer.md`, `code-reviewer.md` — the three agents in the canonical loop.
- `.claude/skills/add-rule/SKILL.md` — the orchestrator.
- `CLAUDE.md` §10 — the project's broader autonomous-workflow framing.
