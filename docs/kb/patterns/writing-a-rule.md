---
title: Writing a rule
description: End-to-end guide for authoring a new ra11y rule, from criterion ID to committed code.
layer: patterns
audience: contributor
---

# Writing a rule

This page is the canonical rule-authoring workflow. It lives in the agent knowledge base so future autonomous runs can retrieve it verbatim. For the human-readable quick path, see [`CLAUDE.md`](../../../CLAUDE.md) §7.

## TL;DR

1. Pick a rule ID: `<domain>/<specific-name>`.
2. Read the normative WCAG text for every criterion you're covering. Quote it verbatim in the rule file header.
3. Create `src/rules/<domain>/<slug>.ts` with `defineRule({...})` and one of `check`, `beforeFile`, or `afterFile`.
4. Write `tests/unit/rules/<domain>/<slug>.test.ts` — ≥3 positive, ≥3 negative, ≥1 edge case per behavior.
5. Register in `src/rules/index.ts` (import + BUILTIN_RULES + export).
6. Run `bun test tests/unit/rules/<domain>/<slug>.test.ts`, `bun run lint`, `bun scripts/check-limits.ts`.
7. Commit rule file + test file + index update in one commit. Atomic, small, reviewable.

## The rule file shape

Every rule is a `defineRule({...})` call with a fixed surface:

```ts
/**
 * Rule: <domain>/<slug>
 * Satisfies: wcag22:X.Y.Z, wcag21:X.Y.Z, section508:..., en301549:...
 * Spec: https://www.w3.org/TR/WCAG22/#<anchor>
 *
 * > <normative text verbatim>
 *
 * Source: https://www.w3.org/TR/WCAG22/#<anchor>
 *
 * <Prose explanation of what the rule flags, why it matters, and
 *  any tradeoffs — false negatives, accepted edge cases, etc.>
 */

import { defineRule } from "../../api/plugin.ts";
import { /* ast helpers */ } from "../../engine/ast-helpers.ts";
import type { /* AST types */ } from "../../types/ast.ts";

export const rule = defineRule({
  id: "<domain>/<slug>",
  satisfies: ["wcag22:X.Y.Z", "wcag21:X.Y.Z"],
  severity: "error" | "warning" | "info",
  scope: "node" | "document" | "project",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description: "<one-line>",
    rationale: "<why this matters to real users>",
    goodExample: `<code>`,
    badExample: `<code>`,
    normativeQuote: "<verbatim WCAG text>",
    references: [
      "https://www.w3.org/TR/WCAG22/#<anchor>",
      "<other spec / MDN links>",
    ],
  },
  check(ctx) { /* or beforeFile / afterFile */ },
});
```

### Scope choice

| Scope | Lifecycle | Use when |
|---|---|---|
| `node` | `check(ctx)` called once per file; rule iterates nodes itself | The rule inspects individual elements in isolation. Examples: `media/alt-text-missing`, `aria/invalid-role`. |
| `document` | `afterFile(ctx)` called once per file | The rule needs cross-element state within a single file — duplicate IDs, heading-order continuity, parent→child relationships. Examples: `semantics/heading-hierarchy`, `parsing/duplicate-id`, `semantics/list-structure`. |
| `project` | `afterProject(ctx)` called once at end of scan | The rule needs state across all files — cross-file ID references, orphaned exports. Not yet used in v0.0.x. |

Default is `node` — only bump to `document` if you genuinely need whole-file state.

### Dual-language rules

Most rules apply to both HTML and JSX. The pattern:

```ts
check(ctx) {
  if (ctx.language === "html") {
    checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
  } else if (
    ctx.language === "tsx" ||
    ctx.language === "jsx" ||
    ctx.language === "ts" ||
    ctx.language === "js"
  ) {
    checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
  }
},
```

HTML attribute names are case-insensitive; JSX attribute names are case-sensitive and follow React conventions (`onClick`, `htmlFor`, `tabIndex`). Accept both HTML-style and React-style names when they coexist (e.g., `autocomplete` and `autoComplete`).

## Violation emission

Rules emit via `ctx.emit(violation)`. The engine stamps `ruleId`, `criteria`, and `filePath` onto every emitted violation — rules don't know their own file path.

```ts
ctx.emit({
  severity: "error",
  location: {
    filePath: "",          // engine fills this in
    line: element.loc.start.line,
    column: element.loc.start.column,
  },
  message: `<concrete, context-aware text>`,
  suggestion: `<actionable fix for this specific case>`,
});
```

Rule of thumb for `message`: mention the element, the broken state, and the user impact in one sentence. Example: `<img> 'chart.png' is missing a text alternative — screen readers will announce the file name or nothing at all.`

Rule of thumb for `suggestion`: include a code snippet or an imperative. Don't write `"add alt text"` — write `"Add alt describing what the image communicates (e.g., alt=\"revenue chart 2026\"). If the image is purely decorative, mark it with alt=\"\" instead."`.

## AST helpers

Rules must not hand-walk ASTs. Use the primitives in `src/engine/ast-helpers.ts`:

- **HTML walkers**: `walkHtmlElements(doc)`, `findHtmlElementsByTag(doc, "img")`, `getHtmlAttribute(el, "alt")`, `hasHtmlAttribute(el, "aria-labelledby")`, `htmlTextContent(el)`, `isDecorativeHtmlElement(el)`.
- **JSX walkers**: `walkJsxElements(module)`, `findJsxElementsByTag(module, "img")`, `getJsxAttribute(el, "alt")`, `getJsxAttributeString(el, "alt")`, `hasJsxAttribute(el, "aria-labelledby")`, `jsxTextContent(el)`, `isDecorativeJsxElement(el)`, `looseAccessibleNameJsx(el)`.
- **CSS walkers**: `walkCssRules(sheet)`, `walkCssAtRules(sheet)`, `findCssDeclaration(rule, "color")`.

If a rule needs a primitive the helpers don't provide, add it to `ast-helpers.ts` via `type-smith`. Never hand-walk from a rule — hand-walks duplicate logic and break when the AST shape evolves.

## JSX-specific gotchas

- **Runtime-valued attributes**: when a JSX attribute value is an expression (`alt={label}`), the rule can't statically know what it resolves to. Accept this as a false-negative — don't flag it. Most rules include `if (attr?.value?.kind === "Expression") return true;` to treat expression-valued attributes as "unknown but probably OK".
- **PascalCase components**: `<Link>`, `<Icon>`, `<Card>`, etc. are React components, not native elements. They may render anything. Most rules treat them as opaque — don't recurse into them, don't flag their children. Match the first character: `tag[0] >= "A" && tag[0] <= "Z"`.
- **Attribute aliases**: React uses `onClick`, `htmlFor`, `tabIndex`, `autoComplete`, `className`. When your rule also applies to HTML, accept both the React-style and HTML-style names to reduce friction.

## Writing the test file

Tests use `bun:test` and the `runRule` helper:

```ts
import { describe, expect, it } from "bun:test";
import { rule } from "../../../../src/rules/<domain>/<slug>.ts";
import { runRule } from "../../../helpers/run-rule.ts";

describe("rule <domain>/<slug>", () => {
  describe("HTML: fires when", () => {
    it("<specific failing input>", () => {
      const violations = runRule(rule, `<html...>`, { filePath: "index.html" });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.ruleId).toBe("<domain>/<slug>");
      expect(violations[0]?.criteria).toContain("wcag22:X.Y.Z");
    });
  });

  describe("HTML: does not fire when", () => {
    it("<specific passing input>", () => { /* ... */ });
  });

  describe("JSX: fires when", () => { /* ... */ });
  describe("JSX: does not fire when", () => { /* ... */ });

  describe("edge cases", () => { /* ... */ });

  describe("rule metadata", () => {
    it("declares every criterion in satisfies", () => {
      expect(rule.satisfies).toContain("wcag22:X.Y.Z");
    });
    it("has a normativeQuote citing WCAG", () => {
      expect(rule.docs.normativeQuote).toBeDefined();
      expect(rule.docs.references[0]).toContain("WCAG22");
    });
  });
});
```

`runRule` parses the source, builds a `RuleContext`, invokes the full lifecycle (`beforeFile` → `check` → `afterFile`), and returns the emitted violations with `ruleId` / `criteria` / `filePath` stamped in — same shape as real `ScanResult` violations.

**Minimum coverage**: ≥3 positive, ≥3 negative, ≥1 edge case per behavior. Don't stub — use realistic inputs that a developer might actually write.

## Budget rules

- **File**: ≤500 effective lines. `scripts/check-limits.ts` enforces.
- **Function**: ≤120 effective lines, ≤5 levels of nesting, cognitive complexity ≤15 (Biome rule).
- **When a function trips the complexity budget**: split into per-case helpers. See `src/rules/semantics/button-name.ts` and `src/rules/semantics/list-structure.ts` for the standard pattern — the top-level check function dispatches to small single-purpose helpers (`checkHtmlNativeButtons`, `checkHtmlInputButtons`, `checkHtmlRoleButtons`).

## Committing

One commit per rule. The commit contains:

1. `src/rules/<domain>/<slug>.ts`
2. `tests/unit/rules/<domain>/<slug>.test.ts`
3. `src/rules/index.ts` (the 3 lines added: import, list entry, export)

Commit message: `feat(rules): add <domain>/<slug> for wcag22:X.Y.Z`. See any recent commit under `git log --grep="feat(rules):"` for the pattern.

Do NOT commit barrel-only updates separately — that breaks atomic review. The barrel update is a trivial part of the rule commit.

## Common mistakes

- **Forgetting the normativeQuote**: every rule must quote the WCAG spec verbatim in its `docs.normativeQuote` field. CI and tests check this.
- **Generic fix suggestions**: "add alt text" is useless; "Add alt describing the chart's message (e.g., alt=\"revenue chart 2026\")" is actionable. Inspect the surrounding AST to produce context-aware text.
- **Flagging JSX expression values**: `alt={label}` is a runtime expression — we can't prove it's invalid. Accept as a false-negative.
- **Missing the `appliesTo.fileExtensions`**: without this the engine runs your rule on every file, wasting cycles.
- **Touching engine code**: rules are content. If you need a new AST primitive, add it to `ast-helpers.ts`. If you need a new engine capability, that's a separate PR — don't smuggle engine work into a rule commit.

## Getting unstuck

- After 3 failed fix attempts on a single rule, report `BLOCKED: <reason>` and stop. Don't guess further.
- Spec interpretation unclear? Quote the normative text verbatim in the rule header and err on the side of the stricter reading — users can always downgrade a rule via config.
- Standing on `wcag22:4.1.1` (Parsing)? It's historical — removed in WCAG 2.2 but still referenced by 2.0/2.1. Keep it in `satisfies` for backward citation and note the deprecation in the header.
