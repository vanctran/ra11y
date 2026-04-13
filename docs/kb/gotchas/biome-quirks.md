---
title: "Biome quirks"
topic: gotcha
audience: contributors
---

# Biome quirks

Things about Biome 2.x that have burned us in ra11y. Keep this page updated as we hit new ones.

## Literal braces in regex-in-code-like strings

Biome's `lint/complexity/noUselessEscapeInRegex` rule treats escapes inside character classes differently from Go-style. `[[({]` is fine unescaped; `\[\(\{` gets flagged. This is correct per ES spec — the issue is that the autofix sometimes unescapes characters that *were* legitimately escaped for readability. Review the suggested fix before accepting.

## Cognitive-complexity false alarms on state-machine code

`lint/complexity/noExcessiveCognitiveComplexity` (max 15) counts every conditional branch. Functions that dispatch on a finite set of states (parsers, formatters) legitimately hit 18–25 and should be refactored into per-state helpers. The rule is usually right — but the refactor target is "extract by state," not "collapse branches."

## Import organization reorders things you just wrote

`assist/source/organizeImports` runs on save in most setups and will rewrite the import block. If you added imports and the file also moved from one dir to another, the sort sometimes produces unexpected diffs. Stage + review before committing.

## `noNonNullAssertion` applies to narrowed cases that shouldn't need it

`const x = arr[i]!` is often rejected even when `i < arr.length` is trivially true. The fix is to assign through a `const tmp = arr[i]; if (!tmp) continue;` pattern — uglier but lint-clean.

## `useLiteralKeys` wants `obj.key` over `obj["key"]`

Fine in most cases but `process.env["CUSTOM_KEY"]` is sometimes required because `process.env` is typed with an index signature under `noPropertyAccessFromIndexSignature`. Solution: disable the lint rule on the single line, or use `process.env.CUSTOM_KEY` if your tsconfig is permissive enough.

## Biome doesn't lint Markdown or YAML

We maintain a separate `check-mermaid.ts` and `check-docs-links.ts` for docs. Biome checks source only.

## Configuration lives in `biome.json`

Not `biome.config.ts`. Not `package.json#biome`. The project uses `biome.json` at the repo root; schema version matches the Biome version in `devDependencies`.

## See also

- `biome.json` — the project's active config.
- [Biome rules catalog](https://biomejs.dev/linter/rules/) — searchable list.
