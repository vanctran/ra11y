/**
 * Rule: contrast/minimum
 * Satisfies: wcag22:1.4.3, wcag21:1.4.3
 * Spec: https://www.w3.org/TR/WCAG22/#contrast-minimum
 *
 * > The visual presentation of text and images of text has a contrast
 * > ratio of at least 4.5:1, except for the following:
 * >   - Large Text: Large-scale text and images of large-scale text
 * >     have a contrast ratio of at least 3:1.
 * >   - Incidental: Text or images of text that are part of an inactive
 * >     user interface component, pure decoration, not visible to anyone,
 * >     or part of a picture that contains significant other visual
 * >     content, have no contrast requirement.
 * >   - Logotypes: Text that is part of a logo or brand name has no
 * >     minimum contrast requirement.
 *
 * Source: https://www.w3.org/TR/WCAG22/#contrast-minimum
 *
 * This rule walks CSS rules looking for pairs of `color` and
 * background-color / background declarations that both resolve to
 * concrete color values (hex, rgb(), hsl(), or one of the 18 named
 * colors we recognize). For each pair, it computes the contrast
 * ratio against WCAG's relative-luminance formula and flags pairs
 * that fail 4.5:1 for normal text or 3:1 for large text.
 *
 * "Large text" heuristic: the rule treats font-size ≥18pt OR font-size
 * ≥14pt with font-weight ≥700 (bold) as large. Sizes in px are
 * converted to pt at 4/3 ratio (96dpi / 72pt-per-inch). Sizes in rem
 * default to 1rem = 16px = 12pt. Without an explicit font-size in
 * the same rule, we assume normal text — the stricter threshold.
 *
 * v0.0.x coverage: in-file CSS rules (standalone .css and <style>
 * blocks). Does NOT yet resolve inherited styles, Tailwind classes,
 * CSS custom properties, or theme variables — those land in Phase 5
 * polish with the theme resolver.
 */

import { defineRule } from "../../api/plugin.ts";
import { walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssDeclaration, CssRule, CssStylesheet } from "../../types/ast.ts";
import { parseColor, type Rgb } from "../../utils/color.ts";
import {
  contrast as contrastRatio,
  WCAG_AA_MIN_LARGE,
  WCAG_AA_MIN_NORMAL,
} from "../../utils/contrast.ts";

export const rule = defineRule({
  id: "contrast/minimum",
  satisfies: ["wcag22:1.4.3", "wcag21:1.4.3"],
  severity: "error",
  scope: "document",
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "Text must have a contrast ratio of at least 4.5:1 against its background (3:1 for large text).",
    rationale:
      "People with moderately low vision (common among older adults) need high contrast to read text. The 4.5:1 minimum compensates for the loss of contrast sensitivity that about 20% of the population experiences by age 80.",
    goodExample: `.button { color: #ffffff; background-color: #2b6cb0; }  /* ratio 6.3:1 */`,
    badExample: `.button { color: #ffffff; background-color: #90caf9; }  /* ratio 1.9:1 */`,
    normativeQuote:
      "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for large text, incidental text, and logotypes.",
    references: [
      "https://www.w3.org/TR/WCAG22/#contrast-minimum",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G18",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "css") return;
    const stylesheet = ctx.ast as CssStylesheet;
    for (const cssRule of walkCssRules(stylesheet)) {
      const pair = extractColorPair(cssRule);
      if (!pair) continue;
      const ratio = contrastRatio(pair.fg, pair.bg);
      const isLarge = isLargeText(cssRule);
      const minimum = isLarge ? WCAG_AA_MIN_LARGE : WCAG_AA_MIN_NORMAL;
      if (ratio >= minimum) continue;
      ctx.emit({
        severity: "error",
        location: {
          filePath: "",
          line: cssRule.loc.start.line,
          column: cssRule.loc.start.column,
        },
        message: buildMessage(cssRule.selector, ratio, minimum, isLarge),
        suggestion: buildSuggestion(pair, ratio, minimum, isLarge),
      });
    }
  },
});

interface ColorPair {
  readonly fg: Rgb;
  readonly bg: Rgb;
  readonly fgSource: string;
  readonly bgSource: string;
}

/**
 * Extracts a usable (foreground, background) Rgb pair from a CSS rule.
 * Returns null when either color is missing or unparseable — the rule
 * stays quiet rather than reporting speculative failures.
 */
function extractColorPair(cssRule: CssRule): ColorPair | null {
  const fgDecl = findDeclaration(cssRule, "color");
  const bgDecl =
    findDeclaration(cssRule, "background-color") ?? findDeclaration(cssRule, "background");
  if (!(fgDecl && bgDecl)) return null;
  const fg = parseColor(extractColorToken(fgDecl.value));
  const bg = parseColor(extractColorToken(bgDecl.value));
  if (!(fg && bg)) return null;
  // Skip transparent backgrounds — we can't compute contrast against
  // an unknown parent color. Phase 5 polish will resolve this via the
  // inheritance-aware theme resolver.
  if (bg.a === 0) return null;
  return { fg, bg, fgSource: fgDecl.value, bgSource: bgDecl.value };
}

function findDeclaration(cssRule: CssRule, property: string): CssDeclaration | undefined {
  const target = property.toLowerCase();
  return cssRule.declarations.find((d) => d.property.toLowerCase() === target);
}

/**
 * `background: #fff url(bg.png) no-repeat;` → "#fff".
 * Pulls the first token that parseColor can understand from a
 * possibly-complex shorthand value.
 */
function extractColorToken(rawValue: string): string {
  const trimmed = rawValue.trim();
  // Fast path: if the whole value parses, use it as-is.
  if (parseColor(trimmed)) return trimmed;
  // Shorthand — split on whitespace not inside parens.
  const tokens = tokenizeValue(trimmed);
  for (const token of tokens) {
    if (parseColor(token)) return token;
  }
  return trimmed;
}

function tokenizeValue(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === " " && depth === 0) {
      if (current.length > 0) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Returns true if the rule's font-size / font-weight qualifies as "large text". */
function isLargeText(cssRule: CssRule): boolean {
  const sizeDecl = findDeclaration(cssRule, "font-size");
  if (!sizeDecl) return false;
  const sizePt = resolveFontSizePt(sizeDecl.value);
  if (sizePt === null) return false;
  if (sizePt >= 18) return true;
  if (sizePt >= 14) {
    const weightDecl = findDeclaration(cssRule, "font-weight");
    if (weightDecl && isBold(weightDecl.value)) return true;
  }
  return false;
}

const PT_PER_PX = 72 / 96;
const PX_PER_REM = 16;
const PX_PER_EM = 16;

/** Parses a font-size value like "18px", "1.125rem", "14pt" into pt. */
function resolveFontSizePt(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  const match = /^([+-]?\d*\.?\d+)(px|pt|rem|em|%)?$/.exec(trimmed);
  if (!match) return null;
  const n = Number.parseFloat(match[1] ?? "0");
  if (!Number.isFinite(n)) return null;
  const unit = match[2] ?? "px";
  if (unit === "pt") return n;
  if (unit === "px") return n * PT_PER_PX;
  if (unit === "rem") return n * PX_PER_REM * PT_PER_PX;
  if (unit === "em") return n * PX_PER_EM * PT_PER_PX;
  // Percent-of-inherited is unresolvable without inheritance — skip.
  return null;
}

function isBold(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "bold") return true;
  if (trimmed === "bolder") return true;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 700;
}

function buildMessage(selector: string, ratio: number, minimum: number, isLarge: boolean): string {
  const size = isLarge ? "large text" : "normal text";
  return `'${selector}' has color contrast ratio ${formatRatio(ratio)}:1 against its background — WCAG 1.4.3 requires ${minimum}:1 for ${size}.`;
}

function buildSuggestion(
  pair: ColorPair,
  ratio: number,
  minimum: number,
  isLarge: boolean,
): string {
  const size = isLarge ? "large text" : "normal text";
  const gap = (minimum / ratio).toFixed(2);
  return `Darken the foreground (\`color: ${pair.fgSource}\`) or lighten the background (\`background: ${pair.bgSource}\`). The current ratio is ${formatRatio(ratio)}:1; you need ${minimum}:1 for ${size} (${gap}× more contrast). Try a foreground color ~${Math.ceil(((minimum - ratio) / minimum) * 100)}% darker, or use the WebAIM Contrast Checker to tune the pair.`;
}

function formatRatio(ratio: number): string {
  return ratio.toFixed(2);
}
