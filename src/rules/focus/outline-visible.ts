/**
 * Rule: focus/outline-visible
 * Satisfies: wcag22:2.4.7, wcag21:2.4.7
 * Spec: https://www.w3.org/TR/WCAG22/#focus-visible
 *
 * > Any keyboard operable user interface has a mode of operation where
 * > the keyboard focus indicator is visible.
 *
 * Source: https://www.w3.org/TR/WCAG22/#focus-visible
 *
 * Flags CSS rules that set `outline: none`, `outline: 0`, or
 * `outline-style: none` on `:focus` or `:focus-visible` pseudo-classes
 * WITHOUT a replacement focus indicator (box-shadow, border-color
 * change, outline replacement with a non-none value, or background-color
 * change) in the same rule block.
 *
 * This is the #1 focus-visibility antipattern — a "reset" copied from
 * Stack Overflow that strips the browser's default focus ring with no
 * replacement, leaving keyboard users unable to see what element is
 * focused.
 *
 * v0.0.x coverage: in-file CSS rules (standalone .css and <style>
 * blocks). Does NOT yet trace Tailwind classes or inherited styles.
 */

import { defineRule } from "../../api/plugin.ts";
import { findCssDeclaration, walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssRule, CssStylesheet } from "../../types/ast.ts";

/** Properties that serve as replacement focus indicators. */
const REPLACEMENT_INDICATORS: readonly string[] = [
  "box-shadow",
  "border",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "background-color",
  "background",
  "text-decoration",
  // Tailwind ring utilities compile to these CSS custom properties:
  "--tw-ring-offset-shadow",
  "--tw-ring-shadow",
  "--tw-ring-color",
  "--tw-ring-offset-width",
  "ring-color",
];

/** Regex matching :focus or :focus-visible pseudo-classes in a selector. */
const FOCUS_PSEUDO_PATTERN = /:focus(?:-visible)?\b/;

export const rule = defineRule({
  id: "focus/outline-visible",
  satisfies: ["wcag22:2.4.7", "wcag21:2.4.7"],
  severity: "error",
  scope: "document",
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "CSS rules on :focus/:focus-visible must not remove the outline without providing a replacement focus indicator.",
    rationale:
      "Keyboard users rely on the focus indicator to know which element is active. Removing outline with `outline: none` on :focus without a replacement makes the page unusable for anyone navigating by keyboard — sighted screen-reader users, motor-impaired users, and power users alike.",
    goodExample: `button:focus-visible { outline: 2px solid #0066cc; }`,
    badExample: `a:focus { outline: none; }`,
    normativeQuote:
      "Any keyboard operable user interface has a mode of operation where the keyboard focus indicator is visible.",
    references: [
      "https://www.w3.org/TR/WCAG22/#focus-visible",
      "https://www.w3.org/WAI/WCAG22/Techniques/failures/F78",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "css") return;
    const stylesheet = ctx.ast as CssStylesheet;
    for (const cssRule of walkCssRules(stylesheet)) {
      checkCssRule(cssRule, (v) => ctx.emit(v));
    }
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkCssRule(cssRule: CssRule, emit: Emit): void {
  if (!hasFocusPseudo(cssRule.selector)) return;
  if (!removesOutline(cssRule)) return;
  if (hasReplacementIndicator(cssRule)) return;

  // Class-scoped selectors (e.g., .composer-scrollbar:focus-visible)
  // are likely part of a design system that provides replacement focus
  // indicators via composed utility classes (Tailwind ring-*, etc.)
  // in a different rule. Downgrade to info since we can't trace
  // cross-rule composition statically.
  const severity = isScopedSelector(cssRule.selector) ? "info" : "error";
  emit({
    severity,
    location: {
      filePath: "",
      line: cssRule.loc.start.line,
      column: cssRule.loc.start.column,
    },
    message: buildMessage(cssRule.selector),
    suggestion: buildSuggestion(cssRule.selector),
  });
}

/** True if the selector targets a specific class, id, or attribute — not a bare element. */
function isScopedSelector(selector: string): boolean {
  // Strip the :focus/:focus-visible pseudo to examine the base selector.
  const base = selector.replace(/:focus(-visible)?\b/g, "").trim();
  return base.includes(".") || base.includes("#") || base.includes("[");
}

function hasFocusPseudo(selector: string): boolean {
  return FOCUS_PSEUDO_PATTERN.test(selector);
}

/**
 * Returns true if the CSS rule removes the outline via:
 * - `outline: none`
 * - `outline: 0`
 * - `outline-style: none`
 */
function removesOutline(cssRule: CssRule): boolean {
  const outlineDecl = findCssDeclaration(cssRule, "outline");
  if (outlineDecl) {
    const normalized = outlineDecl.value.trim().toLowerCase();
    if (normalized === "none" || normalized === "0" || normalized === "0px") {
      return true;
    }
  }
  const outlineStyleDecl = findCssDeclaration(cssRule, "outline-style");
  if (outlineStyleDecl) {
    const normalized = outlineStyleDecl.value.trim().toLowerCase();
    if (normalized === "none") return true;
  }
  return false;
}

/**
 * Checks whether the SAME CSS rule block provides a replacement focus
 * indicator. A non-none outline value later in the rule also counts
 * (e.g., `outline: none; outline: 2px solid blue;` is a reset pattern).
 */
function hasReplacementIndicator(cssRule: CssRule): boolean {
  // Check for a non-none outline that appears AFTER the none value.
  // findCssDeclaration returns the first, but we need the last.
  if (hasNonNoneOutlineLater(cssRule)) return true;

  for (const indicator of REPLACEMENT_INDICATORS) {
    if (findCssDeclaration(cssRule, indicator) !== undefined) return true;
  }
  return false;
}

/**
 * True if there's an outline declaration with a non-none/0 value after the
 * outline:none declaration. This handles the pattern:
 *   outline: none; outline: 2px solid blue;
 */
function hasNonNoneOutlineLater(cssRule: CssRule): boolean {
  let sawNone = false;
  for (const decl of cssRule.declarations) {
    const prop = decl.property.toLowerCase();
    if (prop === "outline") {
      const val = decl.value.trim().toLowerCase();
      if (val === "none" || val === "0" || val === "0px") {
        sawNone = true;
      } else if (sawNone) {
        return true;
      }
    }
  }
  return false;
}

function buildMessage(selector: string): string {
  return `'${selector}' removes the focus outline without a replacement indicator — keyboard users won't see which element is focused.`;
}

function buildSuggestion(selector: string): string {
  const base = `Add a visible focus indicator to '${selector}'. Replace \`outline: none\` with a custom outline (e.g., \`outline: 2px solid #0066cc\`), or add \`box-shadow: 0 0 0 2px #0066cc\` as an alternative. If you're resetting only to re-style, keep the replacement in the same rule block.`;
  if (isScopedSelector(selector)) {
    return `${base} If this element uses Tailwind's \`focus-visible:ring-*\` or \`focus-visible:outline-*\` classes on the component, the focus indicator is already provided — this note can be suppressed.`;
  }
  return base;
}
