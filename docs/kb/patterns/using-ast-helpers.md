---
title: "Using AST helpers"
topic: pattern
audience: contributors, plugin authors
---

# Using AST helpers

`src/engine/ast-helpers.ts` is the normalized rule-side interface to the three AST kinds (HTML, JSX/TSX, CSS). Always reach for these helpers instead of hand-walking the raw nodes — they handle casing, attribute forms, child-iteration, and fragment edge cases consistently.

## JSX / TSX

- `findJsxElementsByTag(module, tag)` — find every `<Tag>` of a specific name. Matches case-sensitively (so `<img>` ≠ `<Img>`).
- `walkJsxElements(module)` — generator over every JSX element in source order.
- `getJsxAttribute(element, name)` — returns the `JsxAttribute` node or `undefined`.
- `getJsxAttributeString(element, name)` — returns the string value of an attribute, or `undefined` if it's a JSX expression we can't resolve statically.
- `hasJsxAttribute(element, name)` — predicate.
- `jsxTextContent(element)` — concatenated text of all text-node descendants.
- `jsxHasContentChildren(element)` — true if the element has any non-whitespace text or any element children.
- `isDecorativeJsxElement(element)` — checks `alt=""`, `role="presentation"`, `role="none"`, `aria-hidden="true"`.
- `looseAccessibleNameJsx(element)` — best-effort accessible-name computation (aria-labelledby → aria-label → text content → title). Returns `undefined` when the name cannot be resolved statically.

## HTML

Parallels the JSX helpers:

- `findHtmlElementsByTag(doc, tag)` — matches case-insensitively.
- `walkHtmlElements(doc)` — generator in source order.
- `getHtmlAttribute(element, name)` / `hasHtmlAttribute` / `htmlTextContent`.
- `directHtmlChildren(element)` — element children only, skipping text/comment nodes.
- `isDecorativeHtmlElement(element)` — case-insensitive ARIA check.

## CSS

- `walkCssRules(stylesheet)` — generator over every `CssRule` (including rules nested inside at-rules).
- `walkCssAtRules(stylesheet)` — generator over at-rules (`@media`, `@supports`, `@keyframes`, etc.).
- `findCssDeclaration(rule, property)` — case-insensitive property lookup.
- `hasCssDeclaration(rule, property)` — predicate.

## Language guards

Every rule that uses these starts its handler with:

```ts
afterFile(ctx) {
  if (ctx.language !== "html") return;  // or "tsx" | "jsx" | "css"
  // ... walk ast
}
```

The helpers are typed to reject the wrong AST kind (you can't pass a `CssStylesheet` to `walkHtmlElements`), but the language check lets you fail fast and keeps TypeScript happy about the type narrowing.

## Why not hand-walk

Two reasons:

1. **Normalization.** HTML attributes can be quoted with `"`, `'`, or bare. JSX attributes can be string-literal or an expression. The helpers collapse these to a single form so rules don't have to care.
2. **Fragment handling.** TSX files can have bare fragments (`<>`) with no root element; HTML can have no `<html>` wrapper; CSS can start with at-rules. The helpers handle these without crashing; ad-hoc rule code tends to assume a canonical shape and break on real files.

## When a helper doesn't exist

If you find yourself hand-walking more than a few lines, that's a signal to add a helper. Propose it in `src/engine/ast-helpers.ts` rather than inlining. The `type-smith` agent owns this file.

## See also

- `src/engine/ast-helpers.ts` — authoritative definitions.
- [`docs/kb/architecture/input-parsers.md`](../architecture/input-parsers.md) — the AST shape these walk over.
- [`writing-a-rule.md`](./writing-a-rule.md) — how rules consume these.
