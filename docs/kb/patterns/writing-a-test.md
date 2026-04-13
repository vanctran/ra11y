---
title: "Writing a test"
topic: pattern
audience: contributors
---

# Writing a test

How tests are organized in ra11y and what to reach for when.

## Structure

```
tests/
├── unit/                  Fine-grained pure-function tests.
│   ├── engine/            Registry, standard-filter, rule-runner.
│   ├── rules/<domain>/    One file per rule: <slug>.test.ts
│   ├── standards/         One file per standard: golden counts + URLs.
│   ├── config/            Loader precedence, inline-disable parsing.
│   ├── mcp/               Per-tool + server JSON-RPC tests.
│   └── utils/             Contrast, glob, string-width, wrap, etc.
├── integration/           Scanner end-to-end against real fixtures.
├── snapshot/              Formatter output stability.
├── cli/                   runCli() against fixture paths.
├── helpers/               run-rule.ts and other test helpers.
└── fixtures/
    ├── good/<slug>/       Known-clean inputs for <slug>.
    ├── bad/<slug>/        Known-dirty inputs for <slug>.
    └── real-world/        Sanitized snippets from production codebases.
```

## Rule tests: the default shape

Use `tests/helpers/run-rule.ts` to invoke a rule against inline source:

```ts
import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/media/alt-text-missing.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule media/alt-text-missing", () => {
  describe("fires when", () => {
    it("<img> has no alt attribute", () => {
      const v = runRule(rule, '<img src="x">', { filePath: "a.html" });
      expect(v).toHaveLength(1);
      expect(v[0]?.severity).toBe("error");
      expect(v[0]?.message).toContain("alt");
    });
    // ≥2 more positive cases
  });

  describe("does NOT fire when", () => {
    it("<img> has non-empty alt", () => { /* ... */ });
    it("<img> is decorative (alt=\"\")", () => { /* ... */ });
    it("the file is not HTML", () => { /* ... */ });
  });
});
```

Minimum bar per rule: ≥3 positive, ≥3 negative, ≥1 edge case.

## Fixture-backed integration

For end-to-end confidence, add fixtures under `tests/fixtures/good/<slug>/` and `tests/fixtures/bad/<slug>/`, then assert in `tests/integration/<slug>-end-to-end.test.ts`:

```ts
const result = runScan({
  standards: BUILTIN_STANDARDS,
  rules: BUILTIN_RULES,
  enabled: ["wcag22"],
  files: [loadFixture("bad/<slug>/minimal.html")],
});
expect(result.violations).toHaveLength(1);
```

## Formatter snapshots

Formatters get snapshot-style tests in `tests/snapshot/`:

```ts
const output = yourFormatter.format(RESULT, REPORT);
expect(output).toContain("your-marker");
expect(output).not.toContain("<script>raw</script>");  // escape check
```

Prefer `toContain` assertions over full-string snapshots — they're resilient to reordering and easier to update when output evolves.

## CLI tests

`tests/cli/cli.test.ts` invokes `runCli()` against fixture paths and asserts on exit codes + stdout markers:

```ts
const r = await runCli(["tests/fixtures/bad/alt-text-missing"]);
expect(r.exitCode).toBe(1);
expect(r.stdout).toContain("media/alt-text-missing");
```

Avoid full stdout snapshots — ANSI escapes and terminal width make them fragile.

## MCP tests

Two kinds:

1. **Per-tool unit** in `tests/unit/mcp/` — invoke the tool's handler directly with a handcrafted session. Fast.
2. **Integration** in `tests/integration/mcp-session.test.ts` — spawn `bun src/cli.ts --mcp` as a subprocess and drive the JSON-RPC loop. Slow but realistic.

Keep both. The subprocess path catches serialization bugs unit tests miss.

## See also

- [`writing-a-rule.md`](./writing-a-rule.md) — the rule-authoring checklist includes the test bar.
- [`adding-a-fixture.md`](./adding-a-fixture.md) — when to add fixtures.
- [`docs/kb/gotchas/test-flakiness.md`](../gotchas/test-flakiness.md) — patterns that flake and how we handle them.
