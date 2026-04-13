---
title: "forms/label-for-id-mismatch"
severity: "error"
scope: "document"
satisfies: ["wcag22:1.3.1", "wcag21:1.3.1", "wcag22:3.3.2", "wcag21:3.3.2", "wcag22:4.1.2", "wcag21:4.1.2"]
---
# `forms/label-for-id-mismatch`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:1.3.1`, `wcag21:1.3.1`, `wcag22:3.3.2`, `wcag21:3.3.2`, `wcag22:4.1.2`, `wcag21:4.1.2`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
A <label for='X'> must point to an element with id='X' in the same document. A dangling reference breaks screen-reader announcements and label-click-to-focus behavior.
## Why it matters
When a label's `for` attribute does not match any element's `id`, the label is not programmatically associated with any control. Screen readers will not pair the label text with the control, clicking the label will not focus the control, and voice-control users cannot reach the control by speaking its label. Because id lookup is case-sensitive per the HTML spec, a typo like for='emai' vs id='email' silently breaks the association at runtime with no visible indication.
## Normative quote
> Labels or instructions are provided when content requires user input.
## Good example
```tsx
<label for="email">Email address</label>
<input id="email" type="email">
```
## Bad example
```tsx
<label for="emai">Email address</label>
<input id="email" type="email">
```
## References
- <https://www.w3.org/TR/WCAG22/#labels-or-instructions>
- <https://www.w3.org/TR/WCAG22/#info-and-relationships>
- <https://www.w3.org/TR/WCAG22/#name-role-value>
- <https://html.spec.whatwg.org/multipage/forms.html#the-label-element>
