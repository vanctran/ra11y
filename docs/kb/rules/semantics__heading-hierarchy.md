---
title: "semantics/heading-hierarchy"
severity: "warning"
scope: "document"
satisfies: ["wcag22:1.3.1", "wcag21:1.3.1"]
---
# `semantics/heading-hierarchy`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:1.3.1`, `wcag21:1.3.1`
- **Applies to:** .html, .htm
## What it checks
Heading levels must follow a logical hierarchy. A document must have an <h1>, and headings must not skip levels (e.g., h1 → h3).
## Why it matters
Screen-reader users navigate by heading with the H key. A skipped level (h1 → h3) tells them 'this is a sub-sub-section of something that doesn't exist', breaking their mental model of the page structure. Missing an <h1> leaves the user without a document title anchor.
## Normative quote
> Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text.
## Good example
```tsx
<h1>Page</h1>
  <h2>Section</h2>
    <h3>Detail</h3>
```
## Bad example
```tsx
<h1>Page</h1>
    <h3>Detail</h3>  <!-- skipped h2 -->
```
## References
- <https://www.w3.org/TR/WCAG22/#info-and-relationships>
- <https://www.w3.org/WAI/tutorials/page-structure/headings/>
