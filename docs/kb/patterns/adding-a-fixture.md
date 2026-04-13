---
title: "Adding a fixture"
topic: pattern
audience: contributors
---

# Adding a fixture

Fixtures are the realistic inputs our integration tests run against. ra11y has three fixture tiers — each serves a different purpose.

## Tier 1: good + bad pairs per rule

Location: `tests/fixtures/good/<slug>/` and `tests/fixtures/bad/<slug>/`.

Purpose: end-to-end confidence that the rule's behavior matches its promise on realistic (but minimal) input.

Bar:
- 1–3 files per tier. More than three usually means the rule has sub-patterns that deserve their own slug.
- Files should be the **smallest** input that exercises the rule's behavior. Not "a realistic page" — a minimal reproducer.
- Good fixtures should be clean for the rule under test *and* clean for all other rules (so end-to-end scans over the good directory return zero violations). If another rule fires on your good fixture, either fix the fixture or widen the rule's negative cases until it doesn't.

Example:

```
tests/fixtures/good/alt-text-missing/
├── img-with-alt.html              <img alt="descriptive">
├── decorative-empty-alt.html      <img alt="">
└── jsx-img-with-alt.tsx           <img alt="…" />

tests/fixtures/bad/alt-text-missing/
├── img-no-alt.html                <img src="chart.png">
├── img-empty-source.html          <img alt="" src="diagram.png">  (content image marked decorative)
└── jsx-img-no-alt.tsx             <img src="…" />
```

## Tier 2: cross-rule scenarios

Location: `tests/fixtures/scenarios/<name>/`.

Purpose: test that multiple rules interact correctly — no double-firing, correct severity propagation, no missed findings.

Example: a fixture with a `<button>` containing an unlabeled `<img>` exercises both `semantics/button-name` (if the image is the only content and has no alt) and `media/alt-text-missing`. The scenario test asserts both rules fire, not one at the expense of the other.

## Tier 3: real-world

Location: `tests/fixtures/real-world/`.

Purpose: **the moat.** Edge cases discovered in production codebases that existing a11y tools miss. These are the cases that make ra11y visibly better than the competition on real projects.

Bar:
- Sanitized from a real codebase (remove brand names, proprietary identifiers, PII).
- Include a comment at the top explaining what the a11y issue is and what existing tools miss.
- Owned by the `fixture-curator` agent — adding here is a dedicated operation.

Example topics: React PascalCase component wrappers, Tailwind with CSS-in-JS, Next.js App Router layouts, shadcn/ui primitives, Material UI v5 composed components.

## When to add a fixture

- **Every new rule.** Good + bad pair in tier 1.
- **Every bug fix that involved a real-world report.** Add a tier-3 fixture capturing the bug so it doesn't come back.
- **Every cross-rule interaction.** Tier 2 if a reviewer asks "does this fix break rule X?" and you can't prove it without a scenario fixture.

## When NOT to add a fixture

- If the case is already covered by a unit test — don't duplicate.
- If the fixture is a copy of another fixture with one attribute changed — widen the existing one or add a unit test variant.
- If the fixture is pages long — break it up or move the interesting part to a unit test.

## Naming

Slug-first: `alt-text-missing/<descriptor>.html`. The slug should match the rule id with slashes replaced by hyphens (or, for scenarios, a clear noun).

Extensions match the language: `.html`, `.htm` for HTML; `.tsx`, `.jsx` for JSX; `.css` for CSS.

## See also

- [`writing-a-test.md`](./writing-a-test.md) — where the fixtures get consumed.
- `.claude/agents/fixture-generator.md` — the agent that scaffolds tier 1 fixtures.
- `.claude/agents/fixture-curator.md` — the agent that owns tier 3.
