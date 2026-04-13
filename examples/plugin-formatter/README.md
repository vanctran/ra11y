# Example formatter plugin: `slack-markdown`

A minimal ra11y formatter plugin that shapes scan output for Slack's incoming-webhook markdown.

## Why this exists

Slack's markdown is a strict subset of GFM — no tables, no HTML, no horizontal rules. Built-in formatters like `markdown` aim at GitHub/GitLab PR comments, which rely on tables and `<details>`. A minimal custom formatter is a better match for a chat channel.

## Files

- [`formatter.ts`](./formatter.ts) — the formatter itself. Demonstrates the `defineFormatter` API.
- [`test.ts`](./test.ts) — smoke test that instantiates the formatter against a hand-built `ScanResult` and asserts key output markers.
- [`package.json`](./package.json) — illustrates the plugin package shape: scoped name, `main` pointing at the formatter, `peerDependencies: "@ra11y/core"`.

## Running

```sh
cd examples/plugin-formatter
bun test.ts
```

CI runs this as part of the plugin-examples job so any breaking change in the plugin API surface shows up immediately.

## Authoring your own

1. Copy this directory as a template.
2. Swap the id and the `format` implementation.
3. Add a minimal `test.ts` that exercises the formatter's happy path and at least one edge case (empty findings, very long messages, characters the target renderer mangles).

See `docs/plugins/authoring-a-formatter.md` for the full reference.
