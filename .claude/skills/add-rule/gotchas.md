# /add-rule gotchas

Update this file whenever an autonomous rule addition surfaces a new pitfall.

## Generic fix suggestions

A rule that reports "missing alt text" is rejected by `a11y-reviewer`. Context-aware fixes like "this `<img>` is inside a `<button>` with no label — alt should describe the button action" are mandatory. Always inspect surrounding AST nodes before building the suggestion string.

## Missing cross-standard coverage

`satisfies` must include every criterion the rule logically checks, including Section 508 and EN 301 549 equivalents. Grep for equivalents in `src/standards/*/criteria.ts` before writing the rule.

## Hand-walking the AST

If `src/engine/ast-helpers.ts` is missing a primitive you need, stop. Dispatch to `type-smith` to add the helper. Rules do not walk ASTs directly — that's a compositional invariant of the engine.

## Test naming

`tests/unit/rules/<domain>/<slug>.test.ts` — the `<domain>` must match the folder under `src/rules/`. CI layout check fails if they drift.

## The evaluator-optimizer loop never converges

If you've hit iteration 3 and the reviewer still rejects: the problem is usually one of:
1. The spec is genuinely ambiguous — quote it verbatim and mark the rule `partial`, adding a manual checklist entry.
2. The rule is trying to check something not statically decidable — route the criterion to checklist-only and do not add a rule.
3. The rule is correct but the fixtures don't exercise the case the reviewer cares about — add the missing fixture and iterate.

Do not force-merge a rejected rule.

## Forgetting to register in `src/rules/index.ts`

The rule file exists, tests pass, but `--list-rules` doesn't show it. The registration step is easy to miss — `rule-implementer` has a dedicated commit for it for this reason.

## Inline disable comments

Your rule should honor `// ra11y-disable-next-line <rule-id>` by default — the engine filters violations per `(ruleId, line)` before emission. If your rule's `check()` is doing its own emission and not going through `ctx.emit()`, disables won't apply. Use `ctx.emit()`.

## Large-text boundary for contrast rules

WCAG 1.4.3 allows 3:1 for text that is ≥18pt regular OR ≥14pt bold. Missing the bold branch is a common bug. Use `isLargeText(node, css)` from ast-helpers.

## Decorative image detection

An image is "decorative" when any of: `alt=""`, `aria-hidden="true"`, `role="presentation"`, `role="none"`. All four matter. See `isDecorativeImage` in ast-helpers.
