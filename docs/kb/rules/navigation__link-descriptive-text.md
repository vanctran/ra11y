---
title: "navigation/link-descriptive-text"
severity: "warning"
scope: "node"
satisfies: ["wcag22:2.4.4", "wcag21:2.4.4"]
---
# `navigation/link-descriptive-text`
- **Severity:** warning
- **Scope:** node
- **Satisfies:** `wcag22:2.4.4`, `wcag21:2.4.4`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Link text must describe the link's destination or purpose, not generic phrases like 'click here' or 'read more'.
## Why it matters
Screen readers read links out of context — users scan the links list, Tab through them, or use the VoiceOver rotor. A link that says 'here' tells users nothing about where it goes. Descriptive link text also helps sighted users scanning a page and improves SEO.
## Normative quote
> The purpose of each link can be determined from the link text alone or from the link text together with its programmatically determined link context.
## Good example
```tsx
<a href="/docs/api">Read the API reference</a>
```
## Bad example
```tsx
<a href="/docs/api">Click here</a>
```
## References
- <https://www.w3.org/TR/WCAG22/#link-purpose-in-context>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G91>
