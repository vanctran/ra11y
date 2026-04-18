---
title: Authoring a ra11y rule plugin
audience: plugin authors
---

# Authoring a ra11y rule plugin

A **rule** is a pure function over a single file's AST that emits zero or more violations. ra11y ships a growing set of built-in rules covering the auto-detectable WCAG 2.2/2.1 criteria (see `src/rules/index.ts` for the current inventory); plugins let you add your own for organization-specific conventions, emerging WCAG techniques, or framework-specific patterns (e.g. Next.js router constraints, Shopify's Liquid templates).

See the runnable reference at [`examples/plugin-rule/`](../../examples/plugin-rule/).

## The `defineRule` surface

```ts
import { defineRule } from "@ra11y/core/plugin";

export const rule = defineRule({
  id: "your-domain/your-rule-name",
  satisfies: ["wcag22:1.1.1", "section508:1194.22.a"],
  severity: "error" | "warning" | "info",
  scope: "node" | "document" | "project",
  appliesTo: {
    fileExtensions: [".html", ".tsx"],
    nodeTypes: ["JSXElement:img"], // optional
  },
  docs: {
    description: "One-line summary of what the rule flags.",
    rationale: "Why this matters — who is harmed when the rule fails.",
    goodExample: "<img src='x' alt='descriptive alt'>",
    badExample: "<img src='x'>",
    normativeQuote: "Exact text quoted from the spec, when useful.",
    references: ["https://www.w3.org/TR/WCAG22/#non-text-content"],
  },
  check(ctx) {
    // Return Violation[] or void. Use ctx.emit for streaming.
  },
});
```

## Required fields

- `id` — globally unique, slash-delimited: `<domain>/<specific-name>`. Existing domains under `src/rules/` are the canonical set (`media`, `contrast`, `focus`, `aria`, `forms`, `semantics`, `navigation`, …). Pick one that fits or invent a new one.
- `satisfies` — every criterion the rule can claim to check. Cite them by standard-prefixed id (`wcag22:1.1.1`, `section508:1194.22.a`). ra11y's engine fans this out across every loaded standard via `equivalentTo` — one rule satisfying `wcag22:1.1.1` automatically satisfies `wcag21:1.1.1`, `section508:1194.22.a`, and `en301549:9.1.1.1` without the rule knowing.
- `severity` — `error` (must-fix), `warning` (should-fix), `info` (observation worth reading code to verify). Pick `info` when the rule hits a case where static analysis can't resolve the question but an agent reading source code can.
- `scope` — `node` means check a single AST node, `document` means check the whole file as one unit, `project` means defer to an after-all-files hook.
- `appliesTo.fileExtensions` — narrow the rule to the languages it understands. A rule that only speaks CSS should list `[".css"]`, not every extension.
- `docs.description`, `docs.rationale`, `docs.goodExample`, `docs.badExample`, `docs.references` — enforced by the `check-tsdoc` guard. Empty fields fail CI. Describe the impact on users with disabilities, not the technical symptom.

## Writing the `check` implementation

The rule receives a `RuleContext` with:

- `ctx.ast` — the parsed AST (`HtmlDocument`, `TsxModule`, or `CssStylesheet` depending on the file).
- `ctx.language` — `"html"`, `"tsx"`, `"jsx"`, or `"css"`. Always guard the first line with `if (ctx.language !== "...")` so rules that only speak one language stay quiet on others.
- `ctx.emit(violation)` — streams a violation. Prefer this over returning an array when the check accumulates findings mid-walk.

Use the AST helpers in `src/engine/ast-helpers.ts` — `findJsxElementsByTag`, `getHtmlAttribute`, `walkCssRules`, `htmlTextContent`, `jsxTextContent` — rather than hand-walking. They handle casing, attribute forms, and fragment edge cases. See [`docs/kb/patterns/using-ast-helpers.md`](../kb/patterns/using-ast-helpers.md) for the full list.

## Emitting a violation

```ts
ctx.emit({
  severity: "error",
  location: {
    filePath: "",        // injected by the engine; leave empty
    line: node.loc.start.line,
    column: node.loc.start.column,
  },
  message: "Short human-readable summary.",
  suggestion: "Context-aware fix — inspect surrounding nodes and tailor the text.",
});
```

The `suggestion` field is non-negotiable. "Add alt text" is not a suggestion. "This `<img src='chart.png'>` is inside a `<button>` with no accessible name; alt should describe the button's destination (e.g. `alt=\"View Q4 revenue report\"`)" is.

## Packaging

A rule plugin is a regular npm package with `@ra11y/core` in `peerDependencies`:

```jsonc
{
  "name": "ra11y-plugin-your-org-name",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "peerDependencies": { "@ra11y/core": ">=0.1.0 <1.0.0" }
}
```

Users opt in via `ra11y.config.ts`:

```ts
import { defineConfig } from "@ra11y/core/plugin";
import myRule from "ra11y-plugin-your-org-name";

export default defineConfig({
  plugins: { rules: [myRule] },
});
```

## Testing

At minimum, your plugin should ship a test that proves:

1. The rule loads under `defineRule` (no silent type drift from a ra11y upgrade).
2. A known-bad fixture produces exactly one violation with the expected `ruleId`.
3. A known-good fixture produces zero violations.

The [`examples/plugin-rule/test.ts`](../../examples/plugin-rule/test.ts) smoke test is a reasonable starting template.

## See also

- [`docs/kb/patterns/writing-a-rule.md`](../kb/patterns/writing-a-rule.md) — the internal authoring guide ra11y contributors follow; most of it applies to third-party plugins too.
- [`docs/kb/architecture/rule-engine.md`](../kb/architecture/rule-engine.md) — how the engine invokes your rule and what order.
- [`docs/kb/patterns/using-ast-helpers.md`](../kb/patterns/using-ast-helpers.md) — every helper available on `ctx`.
