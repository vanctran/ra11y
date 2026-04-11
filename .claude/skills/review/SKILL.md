---
name: review
description: Dispatches code-reviewer + a11y-reviewer (in parallel where relevant) against a git ref or branch. Returns a structured report of invariant violations, correctness issues, and discipline breakdowns. Use before merging or after significant work.
argument-hint: [<ref>]
allowed-tools: Read Grep Glob Bash(git *)
---

# /review $ARGUMENTS

Reviews the committed changes in `$1` (default `HEAD~1..HEAD`).

## Workflow

1. **Resolve the range**: if `$1` is a single ref like `HEAD~5`, review `$1..HEAD`. If `$1` is a range, use it. If omitted, use `HEAD~1..HEAD`.
2. **Inventory the diff**: `git diff --name-only $range` to see which files changed.
3. **Parallel dispatch**:
   - `code-reviewer` reads the diff and checks invariants, correctness, and commit discipline.
   - If any file under `src/rules/` changed, `a11y-reviewer` reads those rules against their cited WCAG text.
4. **Aggregate** the two reports into a single structured output.
5. **Return** the aggregate. Do not fix anything — this is read-only review.

## Return format

```
range: <base>..<head>
files_reviewed: <n>
code_review:
  decision: APPROVED | CHANGES_REQUESTED
  invariant_checks: [...]
  issues: [...]
a11y_review:                         # only present if rules changed
  decision: APPROVED | REJECTED
  issues: [...]
overall: APPROVED | CHANGES_REQUESTED
```
