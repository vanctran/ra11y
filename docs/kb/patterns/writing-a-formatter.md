---
title: "Writing a formatter"
topic: pattern
audience: contributors, plugin authors
---

# Writing a formatter

A formatter is a pure function `(result: ScanResult, report: ReportData) => string`. Internal built-ins live in `src/output/formatters/`; plugin authors see [`docs/plugins/authoring-a-formatter.md`](../../plugins/authoring-a-formatter.md).

## Shortcut: the `/add-formatter` skill

`/add-formatter <name>` scaffolds the file, the snapshot test, and the CLI `--format` registration.

## The scaffold

```ts
import { defineFormatter } from "../../api/plugin.ts";
import type { ReportData, ScanResult } from "../../types/violation.ts";

export const yourFormatter = defineFormatter({
  id: "your-format-name",
  format(result: ScanResult, report: ReportData): string {
    // ...
    return "";
  },
});
```

Register in `src/output/formatters/index.ts` (both the `BuiltinFormatters` interface and the `BUILTIN_FORMATTERS` export). Add the format id to the `CliOptions.format` union in `src/cli/args.ts` and to `normalizeFormat`.

## Design rules (applies to built-in and plugin formatters)

- **One renderer per formatter.** GitHub markdown, Slack markdown, Jira wiki markup, Notion blocks — all different. Don't multiplex.
- **Escape for the target.** Markdown needs `|`, `<`, `>`, `` ` `` escaped. HTML needs `&`, `<`, `>`, `"` escaped. XML (JUnit, SARIF) needs the XML-entity set. Miss one and the renderer mangles a violation message.
- **Stable wire contract.** Machine-consumers (CI, dashboards) pin on field names. Changes bump semver-major.
- **Deterministic output.** Calling `format` twice with the same input returns the same string. Sort violations by a stable key (file + line + column + ruleId) before emitting.
- **Don't hide information by default.** Collapsing long tables into `<details>` is fine; silently dropping findings is not.
- **ra11y eats its own dogfood.** The HTML formatter is itself accessible — proper heading hierarchy, table captions, color contrast that meets WCAG in both light and dark modes. If you're writing a formatter that produces accessible output as a side effect, the output itself should be accessible too.

## Testing

Every formatter ships `tests/snapshot/<name>.test.ts` with:

1. A realistic `ScanResult` (2–3 violations across severities) — asserts key markers in output.
2. Empty-violations case — asserts non-empty, valid output.
3. Escape fuzzing — violation message with every character your renderer treats specially; assert output contains the escaped form, not the raw form.
4. Determinism — call `format` twice, assert equal.

See `tests/snapshot/sarif-junit-markdown.test.ts` for the pattern.

## When to add a built-in vs ship a plugin

Built-in when the output target is universal enough that every ra11y user might reach for it (terminal, plain, json, sarif, junit, markdown, html, agent). Plugin when the target is ecosystem-specific (Slack, Teams, Jira, Notion, your internal dashboard).

## See also

- [`docs/kb/architecture/output-formatters.md`](../architecture/output-formatters.md) — the registry surface and each built-in's purpose.
- [`docs/plugins/authoring-a-formatter.md`](../../plugins/authoring-a-formatter.md) — plugin-side packaging.
