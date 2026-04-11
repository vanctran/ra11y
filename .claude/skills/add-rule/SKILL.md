---
name: add-rule
description: Scaffolds a new ra11y rule end-to-end from a criterion ID using the evaluator-optimizer pattern — spec-researcher produces WCAG context, rule-implementer generates, a11y-reviewer critiques, iterate up to 3 times, then code-reviewer signs off. Use when adding any new rule.
argument-hint: <criterion-id> [--domain <domain>]
allowed-tools: Read Grep Glob Bash(bun *) Bash(git *)
---

# /add-rule $ARGUMENTS

Implements a new rule for criterion `$1` using the evaluator-optimizer loop from `CLAUDE.md` section 10.

Templates: [rule.ts.tpl](templates/rule.ts.tpl), [test.ts.tpl](templates/test.ts.tpl), [fixture.tsx.tpl](templates/fixture.tsx.tpl).

Gotchas: see [gotchas.md](gotchas.md).

## Preconditions

1. Working tree is clean: `git status --porcelain` must be empty.
2. Criterion `$1` exists in `src/standards/*/criteria.ts` — grep for it and abort if not found.
3. No rule in `src/rules/` already satisfies `$1` — grep for `satisfies.*$1` in `src/rules/**/*.ts`.

## Workflow

1. **Preflight**: run `/verify` to confirm baseline is green. If not, stop and report.
2. **Research**: dispatch to `spec-researcher` with criterion `$1`. It will create or refresh `docs/kb/wcag/<local-id>-<slug>.md` with the normative text, examples, and edge cases. Wait for its commit to land.
3. **Generate (iteration 1)**: dispatch to `rule-implementer` with the criterion ID and a reference to the kb entry. It produces the rule + tests + fixtures in 5–7 atomic commits.
4. **Evaluate**: dispatch to `a11y-reviewer`. It reads the rule against the WCAG normative text and the kb entry and returns either `APPROVED` or a list of issues.
5. **If APPROVED**: continue to step 6.
   **If REJECTED**: re-dispatch to `rule-implementer` with the reviewer's issue list as feedback. Loop steps 4–5 up to **3 total iterations**. After 3, report `BLOCKED` with outstanding issues and stop.
6. **Independent review**: dispatch to `code-reviewer` for a correctness + discipline pass on the committed range.
7. **Docs regen**: run `/fix-drift` to regenerate `docs/kb/rules/<slug>.md` from rule metadata.
8. **Final verify**: run `/verify`.
9. **Check off** the corresponding `.claude/backlog.md` item.
10. **Report** the summary: commits, criteria satisfied, iteration count.

## Return format

```
rule: <domain>/<slug>
criteria: [wcag22:X.Y.Z, wcag21:X.Y.Z, section508:…, en301549:…]
iterations: <1-3>
commits: [<sha>, <sha>, …]
reviewer_decision: APPROVED
code_review: APPROVED
verify: passed
kb_regenerated: yes
backlog_checked: yes
```

## Rollback

If any step 2–7 fails and there are only uncommitted changes: `git restore .` and `git clean -fd src/rules tests/unit/rules tests/fixtures docs/kb`. If commits have already landed, do not rewrite history — leave the partial work in place, report the blocker clearly, and let the user decide whether to revert or fix forward.
