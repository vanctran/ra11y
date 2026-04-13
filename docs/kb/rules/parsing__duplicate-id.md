---
title: "parsing/duplicate-id"
severity: "error"
scope: "document"
satisfies: ["wcag21:4.1.1", "wcag22:1.3.1", "wcag21:1.3.1", "wcag22:4.1.2", "wcag21:4.1.2"]
---
# `parsing/duplicate-id`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag21:4.1.1`, `wcag22:1.3.1`, `wcag21:1.3.1`, `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm
## What it checks
Element IDs must be unique within a document. Duplicate IDs break aria-labelledby, label associations, and anchor navigation.
## Why it matters
Screen readers and browsers use element IDs to resolve aria-labelledby, aria-describedby, label[for], and anchor-link targets. When two elements share an ID, the resolution is undefined — getElementById returns only the first match, so the accessible name, description, or label of the second element is lost.
## Normative quote
> In content implemented using markup languages, IDs are unique, except where the specifications allow these features.
## Good example
```tsx
<input id="email"> <label for="email">Email</label>
```
## Bad example
```tsx
<input id="email"> <input id="email">
```
## References
- <https://www.w3.org/TR/WCAG21/#parsing>
- <https://www.w3.org/WAI/WCAG21/Techniques/general/F77>
