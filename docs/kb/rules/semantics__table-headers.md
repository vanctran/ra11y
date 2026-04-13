---
title: "semantics/table-headers"
severity: "warning"
scope: "node"
satisfies: ["wcag22:1.3.1", "wcag21:1.3.1"]
---
# `semantics/table-headers`
- **Severity:** warning
- **Scope:** node
- **Satisfies:** `wcag22:1.3.1`, `wcag21:1.3.1`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Data tables must have <th> header cells so screen readers can announce column or row context for each data cell. A <table> with <td> cells but no <th> is flagged.
## Why it matters
Screen readers associate each <td> with its corresponding <th> and announce the header before (or alongside) the cell value, producing 'Price, $50' instead of just '$50'. Without <th>, the table is a named data structure with no labels — non-sighted users get a stream of values with no context. If the table is for visual layout only, mark it explicitly with role='presentation'.
## Normative quote
> Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text.
## Good example
```tsx
<table>
  <thead><tr><th scope="col">Product</th><th scope="col">Price</th></tr></thead>
  <tbody><tr><td>Widget</td><td>$50</td></tr></tbody>
</table>
```
## Bad example
```tsx
<table>
  <tr><td>Product</td><td>Price</td></tr>
  <tr><td>Widget</td><td>$50</td></tr>
</table>
```
## References
- <https://www.w3.org/TR/WCAG22/#info-and-relationships>
- <https://www.w3.org/WAI/tutorials/tables/>
- <https://www.w3.org/WAI/tutorials/tables/two-headers/>
