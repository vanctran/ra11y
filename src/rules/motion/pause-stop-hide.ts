/**
 * Rule: motion/pause-stop-hide
 * Satisfies: wcag22:2.2.2, wcag21:2.2.2
 * Spec: https://www.w3.org/TR/WCAG22/#pause-stop-hide
 *
 * > For moving, blinking, scrolling, or auto-updating information, all
 * > of the following are true: [a mechanism to pause, stop, or hide is
 * > available].
 *
 * Source: https://www.w3.org/TR/WCAG22/#pause-stop-hide
 *
 * This rule checks two things:
 *   1. HTML: flags <marquee> elements (obsolete, always animated, no
 *      pause mechanism).
 *   2. CSS: flags animation/transition properties that are NOT inside a
 *      prefers-reduced-motion media query guard. If the stylesheet has
 *      at least one prefers-reduced-motion query, animations outside it
 *      are still flagged.
 */

import { defineRule } from "../../api/plugin.ts";
import { findHtmlElementsByTag, walkCssAtRules, walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssAtRule, CssRule, CssStylesheet, HtmlDocument } from "../../types/ast.ts";

const ANIMATION_PROPERTIES: ReadonlySet<string> = new Set([
  "animation",
  "animation-name",
  "animation-duration",
  "transition",
  "transition-property",
  "transition-duration",
]);

export const rule = defineRule({
  id: "motion/pause-stop-hide",
  satisfies: ["wcag22:2.2.2", "wcag21:2.2.2"],
  severity: "error",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".css"],
  },
  docs: {
    description:
      "Moving or auto-updating content must have a mechanism to pause, stop, or hide. <marquee> is always flagged. CSS animations without a prefers-reduced-motion guard are flagged.",
    rationale:
      "People with attention deficits, vestibular disorders, or seizure conditions can be severely affected by motion they cannot control. A prefers-reduced-motion media query lets the browser honor the user's OS-level motion preference.",
    goodExample: `@media (prefers-reduced-motion: reduce) {\n  .spinner { animation: none; }\n}`,
    badExample: `<marquee>Breaking news</marquee>\n\n.spinner { animation: spin 1s infinite; }`,
    normativeQuote:
      "For moving, blinking, scrolling, or auto-updating information, all of the following are true.",
    references: [
      "https://www.w3.org/TR/WCAG22/#pause-stop-hide",
      "https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtmlMarquee(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
    }
  },
  afterFile(ctx) {
    if (ctx.language !== "css") return;
    checkCssAnimations(ctx.ast as CssStylesheet, (v) => ctx.emit(v));
  },
});

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkHtmlMarquee(doc: HtmlDocument, emit: Emit): void {
  for (const element of findHtmlElementsByTag(doc, "marquee")) {
    emit({
      severity: "error",
      location: {
        filePath: "",
        line: element.loc.start.line,
        column: element.loc.start.column,
      },
      message:
        "<marquee> is an obsolete element that creates moving text with no built-in pause mechanism — it violates WCAG 2.2.2.",
      suggestion:
        "Remove <marquee> and replace with static text, or use a CSS animation wrapped in a prefers-reduced-motion media query with a visible pause/stop button.",
    });
  }
}

function checkCssAnimations(stylesheet: CssStylesheet, emit: Emit): void {
  const guardedRules = collectReducedMotionRules(stylesheet);
  // Universal override: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { … } }`
  // is the canonical pattern recommended by MDN. When present, every selector in
  // the stylesheet is already covered — no need to flag individual animations.
  if (hasUniversalReducedMotionOverride(guardedRules)) return;
  for (const cssRule of walkCssRules(stylesheet)) {
    if (guardedRules.has(cssRule)) continue;
    for (const decl of cssRule.declarations) {
      if (!ANIMATION_PROPERTIES.has(decl.property.toLowerCase())) continue;
      // Skip declarations that disable animation (e.g., animation: none)
      if (isNoneValue(decl.value)) continue;
      emit({
        severity: "warning",
        location: {
          filePath: "",
          line: decl.loc.start.line,
          column: decl.loc.start.column,
        },
        message: `'${cssRule.selector}' uses ${decl.property} without a prefers-reduced-motion media query guard — users who prefer reduced motion cannot disable this animation.`,
        suggestion: `Wrap the animation in @media (prefers-reduced-motion: reduce) { ${cssRule.selector} { ${decl.property}: none; } } or move the entire rule inside a prefers-reduced-motion query.`,
      });
      // One violation per rule is enough — don't flag both animation and
      // animation-duration on the same selector.
      break;
    }
  }
}

/**
 * Collects all CssRule nodes that are nested inside a
 * @media (prefers-reduced-motion) at-rule.
 */
function collectReducedMotionRules(stylesheet: CssStylesheet): ReadonlySet<CssRule> {
  const guarded = new Set<CssRule>();
  for (const atRule of walkCssAtRules(stylesheet)) {
    if (!isReducedMotionQuery(atRule)) continue;
    for (const child of walkAtRuleChildren(atRule)) {
      guarded.add(child);
    }
  }
  return guarded;
}

function isReducedMotionQuery(atRule: CssAtRule): boolean {
  if (atRule.name.toLowerCase() !== "media") return false;
  return /prefers-reduced-motion/i.test(atRule.params);
}

/**
 * Recognizes the canonical universal override:
 *   @media (prefers-reduced-motion: reduce) {
 *     *, *::before, *::after {
 *       animation-duration: 0.01ms !important;
 *       transition-duration: 0.01ms !important;
 *     }
 *   }
 * When this pattern is present, every selector in the stylesheet is covered.
 */
function hasUniversalReducedMotionOverride(guardedRules: ReadonlySet<CssRule>): boolean {
  for (const rule of guardedRules) {
    if (!isUniversalSelector(rule.selector)) continue;
    if (disablesAnimationOrTransition(rule)) return true;
  }
  return false;
}

/** True if the selector targets every element — `*`, `*, *::before, *::after`, etc. */
function isUniversalSelector(selector: string): boolean {
  const parts = selector.split(",").map((s) => s.trim());
  if (parts.length === 0) return false;
  return parts.every((p) => p === "*" || p === "*::before" || p === "*::after" || p === "*:root");
}

/** True if the rule zeroes out animation-duration or transition-duration. */
function disablesAnimationOrTransition(rule: CssRule): boolean {
  for (const decl of rule.declarations) {
    const prop = decl.property.toLowerCase();
    if (!ANIMATION_PROPERTIES.has(prop)) continue;
    if (isNoneValue(decl.value) || isNearZeroDuration(decl.value)) return true;
  }
  return false;
}

/** MDN's canonical value is 0.01ms; accept anything effectively instantaneous. */
function isNearZeroDuration(value: string): boolean {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/!important$/i, "")
    .trim();
  return /^0*\.?0*\d*ms$/.test(trimmed) && Number.parseFloat(trimmed) < 1;
}

function* walkAtRuleChildren(atRule: CssAtRule): Iterable<CssRule> {
  for (const child of atRule.children) {
    if (child.kind === "CssRule") {
      yield child;
    } else if (child.kind === "CssAtRule") {
      yield* walkAtRuleChildren(child);
    }
  }
}

function isNoneValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "none" || trimmed === "0s" || trimmed === "0ms";
}
