---
title: "keyboard/accesskey-duplicate"
severity: "error"
scope: "document"
satisfies: ["wcag22:2.1.1", "wcag21:2.1.1", "wcag22:2.1.4", "wcag21:2.1.4"]
---
# `keyboard/accesskey-duplicate`
- **Severity:** error
- **Scope:** document
- **Satisfies:** `wcag22:2.1.1`, `wcag21:2.1.1`, `wcag22:2.1.4`, `wcag21:2.1.4`
- **Applies to:** .html, .htm, .tsx, .jsx
## What it checks
Access keys must be unique within a document. Two elements sharing the same accesskey leave browser behavior undefined and make one of them unreachable by keyboard.
## Why it matters
Access keys bind browser-level keyboard shortcuts (e.g., Alt+S) directly to a single element. When multiple elements claim the same key, the browser can only route the shortcut to one of them — the other becomes unreachable via that shortcut. Comparison is case-insensitive because Alt+S and Alt+Shift+S resolve to the same binding across major engines, and HTML's accesskey attribute accepts a space-separated list of fallback characters, each of which creates its own binding.
## Normative quote
> All functionality of the content is operable through a keyboard interface without requiring specific timings for individual keystrokes.
## Good example
```tsx
<button accesskey="s">Save (Alt+S)</button>
<button accesskey="c">Cancel (Alt+C)</button>
```
## Bad example
```tsx
<button accesskey="s">Save</button>
<button accesskey="S">Send</button>
```
## References
- <https://www.w3.org/TR/WCAG22/#keyboard>
- <https://html.spec.whatwg.org/multipage/interaction.html#the-accesskey-attribute>
