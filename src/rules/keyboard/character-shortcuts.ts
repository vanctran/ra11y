/**
 * Rule: keyboard/character-shortcuts
 * Satisfies: wcag22:2.1.4, wcag21:2.1.4
 * Spec: https://www.w3.org/TR/WCAG22/#character-key-shortcuts
 *
 * > If a keyboard shortcut is implemented in content using only letter
 * > (including upper- and lower-case letters), punctuation, number, or
 * > symbol characters, then at least one of the following is true:
 * > - Turn off: A mechanism is available to turn the shortcut off;
 * > - Remap: A mechanism is available to remap the shortcut to include
 * >   one or more non-printable keyboard characters (e.g. Ctrl, Alt);
 * > - Active only on focus: The keyboard shortcut for a user interface
 * >   component is only active when that component has focus.
 *
 * Source: https://www.w3.org/TR/WCAG22/#character-key-shortcuts
 *
 * Static-analysis scope: this SC is partially automatable. The
 * tractable signal is a JS/TSX `addEventListener('keydown' | 'keypress'
 * | 'keyup', handler)` attached to `window` or `document` whose handler
 * matches a single printable character (`event.key === 'a'`,
 * `e.keyCode === 83`, etc.) without also gating on a non-printable
 * modifier (`ctrlKey`, `metaKey`, `altKey`, `shiftKey`) and without
 * inspecting `event.target` (the focus-guard escape hatch).
 *
 * Severity is "warning" rather than "error" because the heuristic has
 * a false-positive surface: a handler that delegates to a focus check
 * via a helper, or that reads the focused element from a ref/store,
 * looks identical to the failing pattern in raw text. We trade some
 * noise for catching the F99 / F100 single-key shortcut antipattern.
 *
 * Implementation note: the v0.0.x TSX parser only exposes JSX
 * elements, not arbitrary JS expression bodies. We therefore inspect
 * `ctx.source` directly with a small set of regexes anchored on
 * `addEventListener(...)` calls. This is intentionally narrower than
 * a full JS AST walk and stays within the zero-dep invariant.
 */

import { defineRule } from "../../api/plugin.ts";

export const rule = defineRule({
  id: "keyboard/character-shortcuts",
  satisfies: ["wcag22:2.1.4", "wcag21:2.1.4"],
  severity: "warning",
  scope: "document",
  appliesTo: {
    fileExtensions: [".tsx", ".jsx", ".ts", ".js"],
  },
  docs: {
    description:
      "Global single-character keyboard shortcuts must be turn-off-able, remappable, or active-only-on-focus.",
    rationale:
      "Speech-input users (Dragon, Voice Control) and users with motor impairments who hold down keys can fire single-character shortcuts unintentionally, jumping pages or deleting content. Requiring a modifier (Ctrl/Alt/Cmd) or scoping the shortcut to a focused component prevents these accidental activations.",
    goodExample: `useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") save();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);`,
    badExample: `useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "s") save();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);`,
    normativeQuote:
      "If a keyboard shortcut is implemented in content using only letter, punctuation, number, or symbol characters, then at least one of the following is true: Turn off, Remap, or Active only on focus.",
    references: [
      "https://www.w3.org/TR/WCAG22/#character-key-shortcuts",
      "https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html",
      "https://www.w3.org/WAI/WCAG22/Techniques/failures/F99",
    ],
  },
  afterFile(ctx) {
    if (
      ctx.language !== "tsx" &&
      ctx.language !== "jsx" &&
      ctx.language !== "ts" &&
      ctx.language !== "js"
    ) {
      return;
    }
    // Implementation lands in the next commit.
  },
});
