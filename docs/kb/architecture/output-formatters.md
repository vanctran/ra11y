---
title: "Output formatters"
topic: architecture
audience: agents, contributors
---

# Output formatters

A formatter is a pure function `(result: ScanResult, report: ReportData) => string`. ra11y ships eight; every one is narrowly optimized for a specific consumer.

## The built-in eight

| Formatter | Consumer | Why it exists |
|-----------|----------|---------------|
| `terminal` | Human on a TTY | Color, unicode glyphs, box-drawing layout, progress blocks. The default. |
| `plain` | Human on a non-TTY (pipe, logs) | No ANSI, no unicode tricks. Screen-reader friendly. |
| `json` | Machine consumers | Every field the scanner knows, stable wire format, deterministic ordering. |
| `sarif` | Code-scanning integrations (GitHub, Azure DevOps) | SARIF 2.1.0-compliant; feeds directly into the security tab. |
| `junit` | CI runners that visualize test results (Jenkins, CircleCI) | Violations rendered as `<testcase>` failures. |
| `markdown` | PR comment bodies (GitHub, GitLab, Bitbucket) | Tables, `<details>` for long reports, rule-name links to WCAG anchors. |
| `html` | CI artifacts, static dashboards | Self-contained HTML document with inline CSS, dark-mode aware, accessible markup. |
| `agent` | MCP and agent consumers | Token-budgeted; dense structured output; no visual noise. |

## Registry surface

`src/output/formatters/index.ts` exports:

```ts
export interface BuiltinFormatters {
  readonly terminal: Formatter;
  readonly json: Formatter;
  readonly plain: Formatter;
  readonly sarif: Formatter;
  readonly junit: Formatter;
  readonly markdown: Formatter;
  readonly html: Formatter;
  readonly agent: Formatter;
}
```

The shape is closed (not `Record<string, Formatter>`) so adding a new built-in requires updating the `BuiltinFormatters` interface AND the CLI `--format` union in `src/cli/args.ts`. Plugin-authored formatters register through `defineFormatter` + the config loader; they don't touch the builtin record.

## Design rules we follow

- **One formatter, one renderer.** GitHub markdown and Slack markdown have different constraints — they get different formatters.
- **Escape for the target.** The `markdown` formatter escapes `|`, `<`, `>`, `` ` ``. The `html` formatter escapes `&`, `<`, `>`, `"`. The `junit` formatter XML-escapes.
- **Pick a stable contract.** Machine-consumers pin on field names. Changes are semver-major.
- **Don't hide information by default.** Collapsing long output into `<details>` is fine; silently dropping low-severity findings is not.
- **Eat your own dogfood.** The `html` formatter is itself accessible — proper heading hierarchy, `<caption>` on tables, sufficient color contrast in both light and dark mode.

## Testing

Every formatter has a snapshot test that exercises:
- A realistic `ScanResult` with 2–3 violations of mixed severity
- The empty-violations case
- Escape fuzzing on special characters
- Determinism across repeated calls

See `tests/snapshot/sarif-junit-markdown.test.ts` and `tests/snapshot/formatters.test.ts` for the pattern.

## Extending

See [`docs/plugins/authoring-a-formatter.md`](../../plugins/authoring-a-formatter.md) for the external plugin surface. The [`examples/plugin-formatter/`](../../../examples/plugin-formatter/) directory is a runnable Slack-markdown reference.

## See also

- `src/api/plugin.ts` — the `defineFormatter` contract.
- [`docs/kb/patterns/writing-a-formatter.md`](../patterns/writing-a-formatter.md) — the internal authoring guide.
- `src/output/theme/` — the terminal-specific glyphs and layout helpers used by the `terminal` formatter.
