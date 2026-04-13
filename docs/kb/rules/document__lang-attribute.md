---
title: "document/lang-attribute"
severity: "error"
scope: "document"
satisfies: ["wcag22:3.1.1", "wcag21:3.1.1"]
---
# `document/lang-attribute`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:3.1.1`, `wcag21:3.1.1`
- **Applies to:** .html, .htm
## What it checks
HTML documents must declare their primary language via a non-empty lang attribute on <html>.
## Why it matters
Screen readers and translation tools rely on the lang attribute to pick the right pronunciation dictionary and voice. A missing or empty lang attribute makes English content announced with a Japanese voice (or vice versa) unintelligible.
## Normative quote
> The default human language of each web page can be programmatically determined.
## Good example
```tsx
<html lang="en">
```
## Bad example
```tsx
<html>
```
## References
- <https://www.w3.org/TR/WCAG22/#language-of-page>
- <https://www.w3.org/WAI/WCAG22/Techniques/html/H57>
