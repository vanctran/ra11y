---
title: "semantics/landmark-main"
severity: "warning"
scope: "document"
satisfies: ["wcag22:1.3.1", "wcag21:1.3.1"]
---
# `semantics/landmark-main`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:1.3.1`, `wcag21:1.3.1`
- **Applies to:** .html, .htm
## What it checks
Every page should have exactly one <main> landmark. Screen-reader users jump between landmarks to skip repetitive navigation; a missing main leaves them with no primary-content anchor.
## Why it matters
The main landmark is the single most useful navigation target for assistive-tech users. NVDA, JAWS, and VoiceOver all bind a shortcut to 'jump to main'. When it's missing, users have to linearly skim past the header and navigation on every page. When there's more than one, the shortcut becomes ambiguous and users lose the anchor point entirely.
## Normative quote
> Information, structure, and relationships conveyed through presentation can be programmatically determined.
## Good example
```tsx
<body><header>…</header><main>…</main><footer>…</footer></body>
```
## Bad example
```tsx
<body><header>…</header><div class="content">…</div><footer>…</footer></body>
```
## References
- <https://www.w3.org/TR/WCAG22/#info-and-relationships>
- <https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/main.html>
