---
title: "document/meta-refresh"
severity: "error"
scope: "document"
satisfies: ["wcag22:2.2.1", "wcag21:2.2.1", "wcag22:2.2.4", "wcag21:2.2.4", "wcag22:3.2.5", "wcag21:3.2.5"]
---
# `document/meta-refresh`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:2.2.1`, `wcag21:2.2.1`, `wcag22:2.2.4`, `wcag21:2.2.4`, `wcag22:3.2.5`, `wcag21:3.2.5`
- **Applies to:** .html, .htm
## What it checks
<meta http-equiv='refresh'> must not auto-redirect or auto-reload after a delay. Users can't turn off, adjust, or extend the timer, and the page changes context without warning.
## Why it matters
A meta refresh with a non-zero delay imposes a time limit the user cannot control — failing WCAG 2.2.1 (Timing Adjustable). It also triggers an unexpected change of context, failing 3.2.5. Screen reader users may be mid-sentence when the page reloads or navigates; motor-impaired users may not finish reading. The fix is a server-side HTTP redirect, or a link the user activates intentionally.
## Normative quote
> For each time limit that is set by the content, at least one of the following is true: Turn off; Adjust; Extend; Real-time Exception; Essential Exception; 20 Hour Exception.
## Good example
```tsx
<link rel="canonical" href="/new-page">
<!-- Paired with a 301/302 server-side redirect, not a meta refresh. -->
```
## Bad example
```tsx
<meta http-equiv="refresh" content="5; url=/new-page">
```
## References
- <https://www.w3.org/TR/WCAG22/#timing-adjustable>
- <https://www.w3.org/TR/WCAG22/#interruptions>
- <https://www.w3.org/TR/WCAG22/#change-on-request>
- <https://www.w3.org/WAI/WCAG22/Techniques/failures/F40>
- <https://www.w3.org/WAI/WCAG22/Techniques/failures/F41>
