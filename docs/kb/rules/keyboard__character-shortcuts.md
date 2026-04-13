---
title: "keyboard/character-shortcuts"
severity: "warning"
scope: "document"
satisfies: ["wcag22:2.1.4", "wcag21:2.1.4"]
---
# `keyboard/character-shortcuts`
- **Severity:** warning
- **Scope:** document
- **Satisfies:** `wcag22:2.1.4`, `wcag21:2.1.4`
- **Applies to:** .tsx, .jsx, .ts, .js
## What it checks
Global single-character keyboard shortcuts must be turn-off-able, remappable, or active-only-on-focus.
## Why it matters
Speech-input users (Dragon, Voice Control) and users with motor impairments who hold down keys can fire single-character shortcuts unintentionally, jumping pages or deleting content. Requiring a modifier (Ctrl/Alt/Cmd) or scoping the shortcut to a focused component prevents these accidental activations.
## Normative quote
> If a keyboard shortcut is implemented in content using only letter, punctuation, number, or symbol characters, then at least one of the following is true: Turn off, Remap, or Active only on focus.
## Good example
```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") save();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```
## Bad example
```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "s") save();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```
## References
- <https://www.w3.org/TR/WCAG22/#character-key-shortcuts>
- <https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html>
- <https://www.w3.org/WAI/WCAG22/Techniques/failures/F99>
