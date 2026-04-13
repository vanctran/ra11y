---
title: "semantics/empty-heading"
severity: "error"
scope: "node"
satisfies: ["wcag22:2.4.6", "wcag21:2.4.6"]
---
# `semantics/empty-heading`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:2.4.6`, `wcag21:2.4.6`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Heading elements (<h1>-<h6>) must have text content. Empty or whitespace-only headings are invisible to assistive technology.
## Why it matters
Screen-reader users navigate pages by jumping between headings. An empty heading appears in the heading outline as a blank entry, providing no context and disrupting navigation flow.
## Normative quote
> Headings and labels describe topic or purpose.
## Good example
```tsx
<h2>Contact Information</h2>
```
## Bad example
```tsx
<h2></h2>
<h2>   </h2>
<h2><svg aria-hidden="true"></svg></h2>
```
## References
- <https://www.w3.org/TR/WCAG22/#headings-and-labels>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G130>
