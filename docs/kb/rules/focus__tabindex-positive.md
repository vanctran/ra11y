---
title: "focus/tabindex-positive"
severity: "error"
scope: "document"
satisfies: ["wcag22:2.4.3", "wcag21:2.4.3"]
---
# `focus/tabindex-positive`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:2.4.3`, `wcag21:2.4.3`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Elements must not use a positive tabindex. Only tabindex="0" (include at natural position) and tabindex="-1" (programmatic focus only) are acceptable.
## Why it matters
A positive tabindex creates a second, parallel tab order on top of the document's natural order. Focused elements jump across the page in the author-declared sequence before falling back to DOM order, which is deeply disorienting for keyboard and screen-reader users and impossible to keep consistent as the page changes. Every major accessibility style guide — WAI-ARIA Authoring Practices, WebAIM, MDN — treats positive tabindex as an anti-pattern.
## Normative quote
> If a Web page can be navigated sequentially and the navigation sequences affect meaning or operation, focusable components receive focus in an order that preserves meaning and operability.
## Good example
```tsx
<div tabindex="0" role="button">Focusable at document order</div>
<div tabindex="-1">Programmatic focus only</div>
```
## Bad example
```tsx
<a href="/" tabindex="5">Fifth in tab order</a>
```
## References
- <https://www.w3.org/TR/WCAG22/#focus-order>
- <https://webaim.org/techniques/keyboard/tabindex>
- <https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/tabindex>
