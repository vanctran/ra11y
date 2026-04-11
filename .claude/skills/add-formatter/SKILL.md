---
name: add-formatter
description: Scaffolds a new output formatter — file in src/output/formatters/, snapshot tests, CLI --format registration, and a short doc stub. Use when adding terminal/json/sarif/junit/html/markdown/plain or a custom format.
argument-hint: <name>
allowed-tools: Read Grep Glob Bash(bun *) Bash(git *)
---

# /add-formatter $ARGUMENTS

Adds a new output formatter `$1`.

Template: [formatter.ts.tpl](templates/formatter.ts.tpl).

## Preconditions

1. Working tree clean.
2. `src/output/formatters/$1.ts` does not exist.
3. The format name is unique across existing formatters (`grep -l 'id: "$1"' src/output/formatters/`).

## Workflow

1. **Preflight**: `/verify`.
2. **Dispatch** `formatter-author` with `$1` and any format-specific spec (e.g., SARIF 2.1.0 URL).
3. **Register** by adding `$1` to:
   - `src/output/formatters/index.ts`
   - the CLI `--format` validator in `src/cli/args.ts`
   - `docs/cli.md` under the "Output formats" list
4. **Verify**: `/verify` — including snapshot tests.
5. **Commit** any missed registration steps.
6. **Report**.

## Return format

```
formatter: $1
commits: [...]
snapshot_tests: <n>
registered_in_cli: yes
docs_updated: [docs/cli.md]
verify: passed
```
