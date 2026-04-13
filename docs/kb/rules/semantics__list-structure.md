---
title: "semantics/list-structure"
severity: "warning"
scope: "node"
satisfies: ["wcag22:1.3.1", "wcag21:1.3.1"]
---
# `semantics/list-structure`
- **Severity:** warning
- **Scope:** node
- **Satisfies:** `wcag22:1.3.1`, `wcag21:1.3.1`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
<li> must be a direct child of <ul>, <ol>, or <menu>. List containers must only contain <li> (plus script/template).
## Why it matters
Screen readers announce lists as 'list, 3 items' and let users navigate item-by-item with list shortcuts. A stray <li> outside a list container is announced as a generic text block — the list semantic is lost. Mirrored: a <ul> with <div> children instead of <li> is not a list at all.
## Normative quote
> Information, structure, and relationships conveyed through presentation can be programmatically determined.
## Good example
```tsx
<ul>
  <li>Home</li>
  <li>About</li>
  <li>Contact</li>
</ul>
```
## Bad example
```tsx
<div>
  <li>Home</li>
  <li>About</li>
</div>
```
## References
- <https://www.w3.org/TR/WCAG22/#info-and-relationships>
- <https://html.spec.whatwg.org/#the-li-element>
