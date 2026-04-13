---
title: "document/page-titled"
severity: "error"
scope: "document"
satisfies: ["wcag22:2.4.2", "wcag21:2.4.2"]
---
# `document/page-titled`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:2.4.2`, `wcag21:2.4.2`
- **Applies to:** .html, .htm
## What it checks
HTML documents must have a non-empty <title> element describing topic or purpose.
## Why it matters
Screen readers announce the page title when a document loads. A missing or empty title leaves non-sighted users unsure what they've landed on; it also breaks browser tabs, bookmarks, and search engine results.
## Normative quote
> Web pages have titles that describe topic or purpose.
## Good example
```tsx
<title>Settings — Acme Dashboard</title>
```
## Bad example
```tsx
<title></title>
```
## References
- <https://www.w3.org/TR/WCAG22/#page-titled>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G88>
