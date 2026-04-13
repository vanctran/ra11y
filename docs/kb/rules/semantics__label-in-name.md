---
title: "semantics/label-in-name"
severity: "error"
scope: "node"
satisfies: ["wcag22:2.5.3", "wcag21:2.5.3"]
---
# `semantics/label-in-name`
- **Severity:** error
- **Scope:** node
- **Satisfies:** `wcag22:2.5.3`, `wcag21:2.5.3`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
When an interactive element has both visible text and an aria-label, the aria-label must contain the visible text as a substring.
## Why it matters
Voice-control users activate controls by speaking their visible label. If the accessible name (aria-label) doesn't contain that visible text, the voice command fails — the user sees 'Send' but the system only recognizes 'Submit form'.
## Normative quote
> For user interface components with labels that include text or images of text, the name contains the text that is presented visually.
## Good example
```tsx
<button aria-label="Send message">Send</button>
```
## Bad example
```tsx
<button aria-label="Submit form">Send</button>
```
## References
- <https://www.w3.org/TR/WCAG22/#label-in-name>
- <https://www.w3.org/WAI/WCAG22/Understanding/label-in-name>
