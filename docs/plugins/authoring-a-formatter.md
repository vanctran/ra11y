---
title: Authoring a ra11y formatter plugin
audience: plugin authors
---

# Authoring a ra11y formatter plugin

A **formatter** takes a `ScanResult` + `ReportData` and returns a string. ra11y ships eight (terminal, plain, json, sarif, junit, markdown, html, agent); plugins let you shape output for anything else — Slack webhooks, Teams adaptive cards, a CSV for finance, your internal dashboard's JSON contract.

See the runnable reference at [`examples/plugin-formatter/`](../../examples/plugin-formatter/) — a Slack-flavored markdown exporter.

## The `defineFormatter` surface

```ts
import { defineFormatter } from "@ra11y/core/plugin";

export default defineFormatter({
  id: "your-format-id",
  format(result, report) {
    return "...string output...";
  },
});
```

That's the whole API. Formatters are pure functions — no I/O, no side effects, no state. The caller decides what to do with the returned string (write to stdout, upload to a bucket, send to a webhook).

## Inputs

- `result: ScanResult` — every violation plus metadata. Fields you'll likely use:
  - `result.violations[]` — each has `ruleId`, `criteria`, `severity`, `location`, `message`, `suggestion`.
  - `result.filesScanned` — for summary lines.
  - `result.durationMs` — nice for a performance footer.
  - `result.enabledStandards` — what the user asked to be checked against.
  - `result.isTTY` — safe to emit ANSI color if true.
- `report: ReportData` — derived aggregates:
  - `report.coverage[]` — per-standard summary (automated, total, passing, failing).
  - `report.manualReviewNeeded[]` — criterion IDs that need human review.
  - `report.candidates[]` — tier-1 manual-review candidates with locations and review prompts.

## Design rules

- **Target one renderer.** Slack's markdown is a subset of GitHub-flavored markdown. A Teams adaptive card is JSON-shaped. Don't try to satisfy both with one formatter — ship two. The built-in `markdown` formatter optimizes for GitHub PR comments; it is not the right thing for Slack.
- **Escape for your target.** If your target renders markdown, escape `|`, `*`, `_`, `` ` ``, `<`, `>`. If it renders HTML, escape `&`, `<`, `>`, `"`. The `html` formatter in `src/output/formatters/html.ts` is a reference.
- **Pick a stable output contract.** Machine-consumers of your formatter (CI jobs, dashboards) will pin on your field names. Bump a semver-major if you change them.
- **Don't hide information by default.** Collapsing long output into a `<details>` summary is fine; *dropping* low-severity findings without the user asking is not.

## Packaging

```jsonc
{
  "name": "ra11y-formatter-your-format-name",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "peerDependencies": { "@ra11y/core": ">=0.1.0 <1.0.0" }
}
```

Users opt in via `ra11y.config.ts`:

```ts
import { defineConfig } from "@ra11y/core/plugin";
import slackMarkdown from "ra11y-formatter-slack-markdown";

export default defineConfig({
  plugins: { formatters: [slackMarkdown] },
});
```

Then `ra11y --format slack-markdown src/` works.

## Testing

Minimum bar:

1. Happy path — hand-build a `ScanResult` with 2–3 violations, assert the output contains key markers (header, rule IDs, counts).
2. Empty case — `violations: []` should produce a valid output for the target renderer (not an empty string, not a crash).
3. Escape fuzzing — include a violation whose `message` has every special character your renderer interprets. Assert the output renders as plain text.
4. Determinism — calling `format()` twice with the same input returns the same string.

## See also

- [`docs/kb/architecture/output-formatters.md`](../kb/architecture/output-formatters.md) — how ra11y routes between formatters and what the built-in ones optimize for.
- [`docs/kb/patterns/writing-a-formatter.md`](../kb/patterns/writing-a-formatter.md) — the internal authoring guide.
