---
title: "Input parsers"
topic: architecture
audience: agents, contributors
---

# Input parsers

ra11y owns its parsers. `src/input/parsers/` has three: `tsx.ts`, `html.ts`, `css.ts`. All are zero-dep, error-recovering, character-driven recognizers producing the AST types declared in `src/types/ast.ts`.

## Why in-house

- Zero-dep invariant. `@babel/parser` is 2MB with its own dep tree; `postcss` brings ~15 transitive packages; SWC needs WASM.
- Error recovery matters for a11y scanning. Real codebases have syntactically malformed files; we need to scan them anyway and produce useful findings from the well-formed parts.
- Narrow surface. We don't need every syntax form — just enough to locate accessibility-relevant nodes (elements, attributes, selectors, declarations).

## The three parsers

### `tsx.ts`

Minimal JSX/TSX recognizer. Handles:

- `<Tag>`, `<Tag prop>`, `<Tag prop="str">`, `<Tag prop={expr}>`, `<Tag ...spread>`, `<Tag />`
- Nesting, fragments, and closing tags (non-matching tags are recovered, not fatal).
- Component names (PascalCase) are preserved distinct from HTML-like tags (lowercase).
- Type annotations, satisfies expressions, and generic parameters are *tolerated* — the tokenizer skips them rather than erroring.

When the TypeScript compiler API is available at runtime (ADR 0003), the parser upgrades to a full parse and the same AST shape comes out. That keeps downstream rules stable across the two parsing modes.

### `html.ts`

Character-driven HTML5-ish parser with the error-recovery behaviors browsers rely on:

- Implicit closing tags (`<li>` auto-closes at the next `<li>`; `<p>` closes at the next block element).
- Self-closing void elements (`<img>`, `<br>`, `<input>`, etc.) — no closing tag required.
- Attribute quoting is flexible (`attr=value`, `attr='value'`, `attr="value"`, `attr` alone).
- Malformed input is recovered rather than failing — a missing `>` anywhere produces a truncated element and parsing continues from the next sensible boundary.
- `<script>` and `<style>` contents are captured as text (not parsed); rules that care about inline styles read them through the specialized helpers.

### `css.ts`

Character-driven CSS recognizer. Handles rules, declarations, at-rules, media queries, and comments. Skips `@keyframes` interiors. Good enough for:

- Contrast analysis (`contrast/minimum`, `contrast/enhanced`)
- Layout checks (`layout/reflow-hardcoded-width`, `layout/text-spacing`)
- Future non-text-contrast, target-size, and theme resolution.

Does not currently resolve CSS custom properties (`--name`) or `calc()` / `var()`. That's Phase 5 polish via the theme resolver.

## Incremental position tracking (do not regress)

All three parsers maintain `#line` and `#col` incrementally inside their private `#advance(n)` step. Earlier drafts computed position by rescanning from offset 0 on every `#position()` call, which was O(n²) on file size. A 2MB HTML file never returned.

If you are reviewing a new parser or extending an existing one and you see something like:

```ts
for (let i = 0; i < this.#pos; i++) {
  if (this.#src[i] === "\n") line += 1;
}
```

you have reintroduced the bug. Walk `#advance(n)` instead.

## AST shape

All parsers emit records declared in `src/types/ast.ts`:

- `HtmlDocument`, `HtmlElement`, `HtmlAttribute`, `HtmlText`, `HtmlComment`, `HtmlDoctype`
- `TsxModule`, `JsxElement`, `JsxAttribute`, `JsxText`, `JsxExpression`
- `CssStylesheet`, `CssRule`, `CssDeclaration`, `CssAtRule`, `CssComment`

Every node carries a `loc: { start: SourcePosition, end: SourcePosition }` with line + column (1-based).

Rules consume these through the helpers in `src/engine/ast-helpers.ts` — `findJsxElementsByTag`, `getHtmlAttribute`, `walkCssRules`, etc. Rules should almost never walk the raw AST; the helpers normalize casing, attribute forms, and child-iteration patterns.

## See also

- `src/types/ast.ts` — the canonical node shapes.
- `src/engine/ast-helpers.ts` — the preferred rule-side interface.
- [`docs/kb/patterns/using-ast-helpers.md`](../patterns/using-ast-helpers.md) — which helper to reach for when.
- [ADR 0003](../../adr/0003-typescript-peer-for-tsx-parsing.md) — why TypeScript is a peer dep, not a runtime dep.
