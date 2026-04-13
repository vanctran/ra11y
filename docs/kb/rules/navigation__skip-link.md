---
title: "navigation/skip-link"
severity: "warning"
scope: "document"
satisfies: ["wcag22:2.4.1", "wcag21:2.4.1"]
---
# `navigation/skip-link`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:2.4.1`, `wcag21:2.4.1`
- **Applies to:** .html, .htm
## What it checks
Pages with a primary navigation should offer a skip link as the first focusable element so keyboard users can bypass the nav on every page.
## Why it matters
Keyboard-only users (including people using screen readers and people with motor impairments) Tab through every focusable element in source order. On a page with a 12-item primary nav, that's 12 Tab presses on every navigation between pages — which compounds fast. The skip-link pattern is the standard answer: a link at the very top of the page that jumps to `#main`, hidden off-screen until focused.
## Normative quote
> A mechanism is available to bypass blocks of content that are repeated on multiple Web pages.
## Good example
```tsx
<a class="skip-link" href="#main">Skip to main content</a>…<nav>…</nav>…<main id="main">…</main>
```
## Bad example
```tsx
<nav>…12 links…</nav><main>…</main>  <!-- no skip link -->
```
## References
- <https://www.w3.org/TR/WCAG22/#bypass-blocks>
- <https://www.w3.org/WAI/WCAG22/Techniques/general/G1>
