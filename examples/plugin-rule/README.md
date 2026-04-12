# Example: custom ra11y rule plugin

This directory shows the smallest possible ra11y rule plugin. It defines one rule — `example/no-title-attribute-as-label` — and exports it via the `defineRule` helper from `@ra11y/core/plugin`.

## What this rule checks

The [`title` attribute](https://www.tpgi.com/using-the-html-title-attribute-updated/) is notoriously unreliable as an accessible-name source:

- Mobile browsers don't show tooltips at all
- Keyboard-only users can't trigger the tooltip
- Screen-reader support is inconsistent
- Sighted users only see it after a mouse hover delay

So `<button title="Close">×</button>` is technically "named" from a WCAG 4.1.2 perspective, but practically useless. This rule flags the pattern.

## File layout

```
plugin-rule/
├── package.json         # name, peerDependency on @ra11y/core
├── rule.ts              # the defineRule call
└── README.md            # this file
```

## Using it

```ts
// ra11y.config.ts
import { defineConfig } from "@ra11y/core";
import customRule from "./examples/plugin-rule/rule.ts";

export default defineConfig({
  standards: ["wcag22"],
  plugins: { rules: [customRule] },
});
```

The plugin-loader wiring (`plugins` field) is Phase 15 polish. For v0.0.x, you can import the rule directly into a test or wire it into the `BUILTIN_RULES` array in `src/rules/index.ts` for local testing.

## Authoring tips

- **Header citation**: the `satisfies` field lists every criterion the rule checks. Add `wcag22:X.Y.Z` and any cross-standard equivalents so the registry automatically fans out coverage when `section508` or `en301549` is enabled.
- **Context-aware suggestions**: inspect surrounding AST nodes to build the suggestion text. "Use `aria-label`" is generic; "`<button>×</button>` with `title` is a close button — use `aria-label=\"Close\"`" is specific.
- **Use ast-helpers**: import from `@ra11y/core/engine/ast-helpers` (coming in the plugin-API polish) — don't hand-walk ASTs.
- **Three positive, three negative, one edge**: every rule ships with ≥3 positive test cases, ≥3 negative, ≥1 boundary. See `tests/unit/rules/media/alt-text-missing.test.ts` for the canonical shape.

## Running tests against this rule

```sh
bun test examples/plugin-rule/
```

(The example doesn't ship with its own tests yet — add a `tests/` subdirectory following the ra11y pattern if you're using this as a template.)
