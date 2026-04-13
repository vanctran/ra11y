<!--
Thanks for contributing to ra11y! Please fill in the relevant sections.
See CONTRIBUTING.md and CLAUDE.md for the quality bar, commit discipline,
and architectural invariants.
-->

## Summary

<!-- What does this PR do? Why? 1–3 sentences. -->

## Type of change

<!-- Check all that apply. -->

- [ ] New rule (adds an accessibility check)
- [ ] New standard (adds a conformance framework)
- [ ] New formatter (adds an output format)
- [ ] Engine / internals
- [ ] Bug fix
- [ ] Documentation
- [ ] Tooling / CI / hooks
- [ ] Refactor / performance

## Invariants

<!-- Every PR must satisfy these. Mark N/A if not applicable. -->

- [ ] `dependencies: {}` in package.json is still empty
- [ ] No runtime imports of `node:http`, `node:https`, `node:net`, `node:dns`, `fetch`, or `Bun.fetch` from `src/`
- [ ] `bun run verify` passes locally (single entrypoint; runs typecheck, lint, tests, and all invariant checks)

## Rule-specific checklist (if adding a rule)

- [ ] Rule file header cites every WCAG SC and spec URL
- [ ] `satisfies` lists every cross-standard equivalent
- [ ] ≥3 positive and ≥3 negative test cases plus ≥1 edge case
- [ ] Good + bad fixtures under `tests/fixtures/`
- [ ] Registered in `src/rules/index.ts`
- [ ] Violation suggestions are context-aware, not generic

## Testing

<!-- How did you verify this works end-to-end? -->

## Notes

<!-- Anything a reviewer should know — tradeoffs considered, open questions, spec ambiguities. -->
