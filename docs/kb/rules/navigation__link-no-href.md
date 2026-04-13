---
title: "navigation/link-no-href"
severity: "error"
scope: "node"
satisfies: ["wcag22:2.1.1", "wcag21:2.1.1", "wcag22:4.1.2", "wcag21:4.1.2"]
---
# `navigation/link-no-href`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:2.1.1`, `wcag21:2.1.1`, `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
<a> elements with onClick but no href are not keyboard-operable and are announced as generic containers. Use <button> instead, or add a real href.
## Why it matters
An anchor without an href is a dead link. It's not in the tab order, Enter doesn't activate it, and screen readers announce it as a generic container with no role. The common pattern <a onclick='…'>Click me</a> breaks keyboard and screen-reader users completely.
## Normative quote
> All functionality of the content is operable through a keyboard interface.
## Good example
```tsx
<button type="button" onClick={handleClick}>Toggle menu</button>
```
## Bad example
```tsx
<a onClick={handleClick}>Toggle menu</a>
```
## References
- <https://www.w3.org/TR/WCAG22/#keyboard>
- <https://html.spec.whatwg.org/#the-a-element>
