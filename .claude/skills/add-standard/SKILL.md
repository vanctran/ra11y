---
name: add-standard
description: Scaffolds a new accessibility standard module (metadata, criteria, standard export, tests, kb entry). Delegates the criteria enumeration to spec-researcher + standard-builder. Use when adding any conformance framework.
argument-hint: <standard-id> [--references <existing-standard-id>]
allowed-tools: Read Grep Glob Bash(bun *) Bash(git *)
---

# /add-standard $ARGUMENTS

Implements a new standard module for `$1`.

Templates: [criterion.ts.tpl](templates/criterion.ts.tpl).

Gotchas: see [gotchas.md](gotchas.md).

## Preconditions

1. Working tree clean.
2. `src/standards/$1/` does not yet exist.
3. If `--references` is passed, the referenced standard is loaded.

## Workflow

1. **Preflight**: `/verify`.
2. **Research**: dispatch `spec-researcher` with the standard's spec URL to produce `docs/kb/standards/$1.md` with its full criterion list, levels, and WCAG equivalents.
3. **Build**: dispatch `standard-builder` with `$1` and the kb reference. It produces `metadata.ts`, `criteria.ts` (in batches), `standard.ts`, and the golden-file test.
4. **Register**: add `$1` to `src/standards/index.ts` and to the CLI `--standard` validator.
5. **Integration test**: dispatch `test-author` to write `tests/integration/$1-scan.test.ts` confirming that `--standard $1` surfaces the expected violations via equivalentTo-reached rules.
6. **Verify**: `/verify`.
7. **Fix drift**: `/fix-drift` to regenerate `docs/kb/index.md` and `llms.txt`.
8. **Check off** the backlog item.
9. **Report**.

## Return format

```
standard: $1
publisher: <name>
version: <version>
criteria_count: <n>
equivalent_to_wcag: <n>
commits: [...]
verify: passed
```
