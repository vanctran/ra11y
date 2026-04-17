/**
 * Rule: contrast/non-text
 * Satisfies: wcag22:1.4.11, wcag21:1.4.11
 * Spec: https://www.w3.org/TR/WCAG22/#non-text-contrast
 *
 * > The visual presentation of the following have a contrast ratio of at
 * > least 3:1 against adjacent color(s):
 * >   - User Interface Components: Visual information required to identify
 * >     user interface components and states, except for inactive components
 * >     or where the appearance of the component is determined by the user
 * >     agent and not modified by the author.
 * >   - Graphical Objects: Parts of graphics required to understand the
 * >     content, except when a particular presentation of graphics is
 * >     essential to the information being conveyed.
 *
 * Source: https://www.w3.org/TR/WCAG22/#non-text-contrast
 *
 * Static-analysis scope (v0.0.x):
 *   1. CSS rules whose selector targets an interactive component
 *      (button, input, select, textarea, [role="button|checkbox|switch|tab|
 *      menuitem|radio|combobox|slider"], `a` styled like a button) and that
 *      declare BOTH a border / outline color AND a background color in the
 *      same block — flag if border-vs-background contrast < 3:1.
 *   2. CSS rules targeting `svg`, `[role="img"] *`, or stroke/fill on a
 *      non-decorative graphic — flag if fill / stroke contrast against a
 *      same-rule (or sibling parent) background < 3:1.
 *
 * Bypassed cases (matching the spec exemptions):
 *   - "Inactive components": selectors containing :disabled, [disabled],
 *     [aria-disabled="true"], or class tokens matching `disabled`.
 *   - "User agent default": rules that don't author a border/outline/
 *     background color at all are skipped — we only flag what the author
 *     actually styled.
 *   - "Essential" / decorative SVGs: selectors containing [aria-hidden="true"]
 *     or `role="presentation"` / `role="none"`.
 *
 * Reuses the parser + color helpers from `./_shared.ts` so any extraction
 * fix (Tailwind theme resolution, CSS custom properties, etc.) lands in
 * one place for all three contrast rules.
 */

import { defineRule } from "../../api/plugin.ts";
import { findCssDeclaration, walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssRule, CssStylesheet } from "../../types/ast.ts";
import { parseColor, type Rgb } from "../../utils/color.ts";
import { contrast, WCAG_AA_MIN_NON_TEXT } from "../../utils/contrast.ts";

const SC_LABEL = "WCAG 1.4.11";

export const rule = defineRule({
  id: "contrast/non-text",
  satisfies: ["wcag22:1.4.11", "wcag21:1.4.11"],
  severity: "error",
  scope: "document",
  fixClass: "guidance",
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "Borders, outlines, and graphical objects of user interface components must have at least 3:1 contrast against adjacent colors.",
    rationale:
      "Users with low vision rely on the visual boundary of a control (its border, focus ring, or shape) to find and operate it. WCAG 1.4.11 mandates a 3:1 contrast for that boundary against adjacent colors so the control remains identifiable for the same population that needs 1.4.3 text contrast.",
    goodExample: `.btn { background: #ffffff; border: 1px solid #595959; }  /* border ~7.0:1 vs bg */`,
    badExample: `.btn { background: #ffffff; border: 1px solid #d0d0d0; }  /* border 1.6:1 vs bg */`,
    normativeQuote:
      "The visual presentation of user interface components and graphical objects has a contrast ratio of at least 3:1 against adjacent color(s).",
    references: [
      "https://www.w3.org/TR/WCAG22/#non-text-contrast",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G195",
      "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "css") return;
    const stylesheet = ctx.ast as CssStylesheet;
    for (const cssRule of walkCssRules(stylesheet)) {
      checkRule(cssRule, ctx);
    }
  },
});

type Ctx = Parameters<NonNullable<typeof rule.afterFile>>[0];

function checkRule(cssRule: CssRule, ctx: Ctx): void {
  if (isExempt(cssRule.selector)) return;

  const target = classifySelector(cssRule.selector);
  if (target === "ignore") return;

  const bg = readColor(cssRule, "background-color") ?? readColor(cssRule, "background");
  if (!bg) return;

  if (target === "interactive") {
    checkBoundary(cssRule, bg, "border", ctx);
    checkBoundary(cssRule, bg, "border-color", ctx);
    checkBoundary(cssRule, bg, "outline", ctx);
    checkBoundary(cssRule, bg, "outline-color", ctx);
    return;
  }

  // graphic
  checkBoundary(cssRule, bg, "fill", ctx);
  checkBoundary(cssRule, bg, "stroke", ctx);
}

function checkBoundary(cssRule: CssRule, bg: ColorRead, prop: string, ctx: Ctx): void {
  const fg = readColor(cssRule, prop);
  if (!fg) return;
  const ratio = contrast(fg.rgb, bg.rgb);
  if (ratio >= WCAG_AA_MIN_NON_TEXT) return;
  ctx.emit({
    severity: "error",
    location: { filePath: "", line: cssRule.loc.start.line, column: cssRule.loc.start.column },
    message: buildMessage(cssRule.selector, prop, fg.source, bg.source, ratio),
    suggestion: buildSuggestion(prop, fg.source, bg.source, ratio),
  });
}

interface ColorRead {
  readonly rgb: Rgb;
  readonly source: string;
}

function readColor(cssRule: CssRule, property: string): ColorRead | null {
  const decl = findCssDeclaration(cssRule, property);
  if (!decl) return null;
  const token = extractColorToken(decl.value);
  const rgb = parseColor(token);
  if (!rgb) return null;
  if (rgb.a === 0) return null;
  return { rgb, source: decl.value };
}

function extractColorToken(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (parseColor(trimmed)) return trimmed;
  for (const token of tokenizeShorthand(trimmed)) {
    if (parseColor(token)) return token;
  }
  return trimmed;
}

/** Tokenize on spaces while respecting parentheses (rgb(), hsl()). */
function tokenizeShorthand(value: string): readonly string[] {
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

// ---------------------------------------------------------------------------
// Selector classification
// ---------------------------------------------------------------------------

type Target = "interactive" | "graphic" | "ignore";

const INTERACTIVE_TAG_PATTERN =
  /(^|[\s>+~,])(button|input|select|textarea)\b|^\s*a\.btn|\.btn\b|\.button\b/i;
const INTERACTIVE_ROLE_PATTERN =
  /\[role\s*[=~|]?=\s*["']?(?:button|checkbox|switch|tab|menuitem|radio|combobox|slider|link|option|treeitem)["']?\]/i;
const GRAPHIC_PATTERN = /(^|[\s>+~,])svg\b|\[role\s*=\s*["']img["']\]/i;
const DISABLED_PATTERN =
  /:disabled\b|\[disabled\]|\[aria-disabled\s*=\s*["']?true["']?\]|\.disabled\b|\.is-disabled\b/i;
const HIDDEN_PATTERN =
  /\[aria-hidden\s*=\s*["']?true["']?\]|\[role\s*=\s*["'](?:presentation|none)["']\]/i;

function classifySelector(selector: string): Target {
  if (INTERACTIVE_ROLE_PATTERN.test(selector)) return "interactive";
  if (INTERACTIVE_TAG_PATTERN.test(selector)) return "interactive";
  if (GRAPHIC_PATTERN.test(selector)) return "graphic";
  return "ignore";
}

function isExempt(selector: string): boolean {
  if (DISABLED_PATTERN.test(selector)) return true;
  if (HIDDEN_PATTERN.test(selector)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Message + suggestion builders
// ---------------------------------------------------------------------------

function buildMessage(
  selector: string,
  prop: string,
  fgSource: string,
  bgSource: string,
  ratio: number,
): string {
  return `'${selector}' has ${prop} '${fgSource}' with contrast ${ratio.toFixed(2)}:1 against background '${bgSource}' — ${SC_LABEL} requires at least ${WCAG_AA_MIN_NON_TEXT}:1 for non-text UI components and graphics.`;
}

function buildSuggestion(prop: string, fgSource: string, bgSource: string, ratio: number): string {
  const gap = (WCAG_AA_MIN_NON_TEXT / ratio).toFixed(2);
  const darkerHint = suggestDarker(fgSource);
  return `Increase contrast of \`${prop}: ${fgSource}\` against \`background: ${bgSource}\` to at least ${WCAG_AA_MIN_NON_TEXT}:1. The current ratio is ${ratio.toFixed(2)}:1 — you need ${gap}× more contrast.${darkerHint ? ` Try \`${prop}: ${darkerHint}\` for a quick fix, or use the WebAIM Contrast Checker to tune the pair.` : ` Pick a darker boundary color or a lighter background, then verify with the WebAIM Contrast Checker.`}`;
}

/**
 * Best-effort "darker version" hint for hex inputs only — non-hex values
 * return null and the suggestion falls back to generic guidance. We never
 * promise the suggested color clears 3:1 (that depends on the background);
 * the hint is purely a starting point a developer can paste in and tweak.
 */
function suggestDarker(source: string): string | null {
  const rgb = parseColor(source.trim());
  if (!rgb) return null;
  const factor = 0.55; // pull each channel ~45% toward black
  const r = Math.max(0, Math.round(rgb.r * factor));
  const g = Math.max(0, Math.round(rgb.g * factor));
  const b = Math.max(0, Math.round(rgb.b * factor));
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}
