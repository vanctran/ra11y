/**
 * Shared contrast-rule helpers. `contrast/minimum` (WCAG 1.4.3 AA)
 * and `contrast/enhanced` (WCAG 1.4.6 AAA) are structurally
 * identical — they walk CSS rules, extract a (foreground,
 * background) pair, check the font size, and compare the ratio
 * against a threshold. Only the threshold constants differ.
 *
 * This module owns the walking + extraction logic. Callers pass
 * the minima they want applied and the SC they cite. Keeps both
 * rule files short and ensures any extraction bug gets fixed in
 * one place.
 *
 * Cross-file Tailwind cross-reference (`couldBeWrongBecause` opt-in):
 *   `collectTailwindOverrideClasses` walks every JSX / HTML element
 *   in the scan and returns the set of plain class names that co-occur
 *   with a `text-*` or `bg-*` Tailwind utility. When a CSS contrast
 *   failure targets one of those classes, the consumer-site Tailwind
 *   utility overrides the declared color/background and the scanner's
 *   attribute-level evidence is categorically weaker than the agent's
 *   file-level evidence — the rule surfaces `tailwind_class_on_consumer`
 *   as informational signal. Deterministic class-token link, NOT
 *   heuristic suppression (CLAUDE.md §1). See
 *   docs/adr/0009-violation-could-be-wrong-because.md.
 */

import { walkCssRules, walkHtmlElements, walkJsxElements } from "../../engine/ast-helpers.ts";
import { parseTailwind } from "../../input/parsers/tailwind.ts";
import type {
  CssRule as CssCssRule,
  CssDeclaration,
  CssStylesheet,
  HtmlDocument,
  HtmlElement,
  JsxElement,
  TsxModule,
} from "../../types/ast.ts";
import type { Language, ProjectContext } from "../../types/rule.ts";
import { parseColor, type Rgb } from "../../utils/color.ts";
import { contrast } from "../../utils/contrast.ts";

export interface ContrastCheckOptions {
  readonly minNormal: number;
  readonly minLarge: number;
  readonly scLabel: string; // e.g. "WCAG 1.4.3" or "WCAG 1.4.6"
}

export interface ContrastFinding {
  readonly selector: string;
  readonly line: number;
  readonly column: number;
  readonly ratio: number;
  readonly minimum: number;
  readonly isLarge: boolean;
  readonly fgSource: string;
  readonly bgSource: string;
}

interface ColorPair {
  readonly fg: Rgb;
  readonly bg: Rgb;
  readonly fgSource: string;
  readonly bgSource: string;
}

const PT_PER_PX = 72 / 96;
const PX_PER_REM = 16;
const PX_PER_EM = 16;

/**
 * Walk every CSS rule in `stylesheet` and yield a finding for each
 * rule that declares a resolvable color pair whose contrast ratio
 * falls below the supplied threshold.
 */
export function findContrastFailures(
  stylesheet: CssStylesheet,
  opts: ContrastCheckOptions,
): ContrastFinding[] {
  const out: ContrastFinding[] = [];
  for (const cssRule of walkCssRules(stylesheet)) {
    const pair = extractColorPair(cssRule);
    if (!pair) continue;
    const ratio = contrast(pair.fg, pair.bg);
    const isLarge = isLargeText(cssRule);
    const minimum = isLarge ? opts.minLarge : opts.minNormal;
    if (ratio >= minimum) continue;
    out.push({
      selector: cssRule.selector,
      line: cssRule.loc.start.line,
      column: cssRule.loc.start.column,
      ratio,
      minimum,
      isLarge,
      fgSource: pair.fgSource,
      bgSource: pair.bgSource,
    });
  }
  return out;
}

export function buildContrastMessage(finding: ContrastFinding, scLabel: string): string {
  const size = finding.isLarge ? "large text" : "normal text";
  return `'${finding.selector}' has color contrast ratio ${finding.ratio.toFixed(2)}:1 against its background — ${scLabel} requires ${finding.minimum}:1 for ${size}.`;
}

export function buildContrastSuggestion(finding: ContrastFinding): string {
  const size = finding.isLarge ? "large text" : "normal text";
  const gap = (finding.minimum / finding.ratio).toFixed(2);
  return `Darken the foreground (\`color: ${finding.fgSource}\`) or lighten the background (\`background: ${finding.bgSource}\`). The current ratio is ${finding.ratio.toFixed(2)}:1; you need ${finding.minimum}:1 for ${size} (${gap}× more contrast). Try a foreground color ~${Math.ceil(((finding.minimum - finding.ratio) / finding.minimum) * 100)}% darker, or use the WebAIM Contrast Checker to tune the pair.`;
}

function extractColorPair(cssRule: CssCssRule): ColorPair | null {
  const fgDecl = findDeclaration(cssRule, "color");
  const bgDecl =
    findDeclaration(cssRule, "background-color") ?? findDeclaration(cssRule, "background");
  if (!(fgDecl && bgDecl)) return null;
  const fg = parseColor(extractColorToken(fgDecl.value));
  const bg = parseColor(extractColorToken(bgDecl.value));
  if (!(fg && bg)) return null;
  if (bg.a === 0) return null;
  return { fg, bg, fgSource: fgDecl.value, bgSource: bgDecl.value };
}

function findDeclaration(cssRule: CssCssRule, property: string): CssDeclaration | undefined {
  const target = property.toLowerCase();
  return cssRule.declarations.find((d) => d.property.toLowerCase() === target);
}

function extractColorToken(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (parseColor(trimmed)) return trimmed;
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

function isLargeText(cssRule: CssCssRule): boolean {
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
  return null;
}

function isBold(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "bold") return true;
  if (trimmed === "bolder") return true;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 700;
}

// ---------------------------------------------------------------------------
// Cross-file Tailwind cross-reference — `couldBeWrongBecause` opt-in.
// ---------------------------------------------------------------------------

/**
 * Token code surfaced on `Violation.couldBeWrongBecause` when a CSS
 * contrast failure targets a class that co-occurs with a qualifying
 * Tailwind utility on a JSX/HTML consumer. Informational signal only —
 * the agent investigates the consumer file and decides. See
 * docs/adr/0009-violation-could-be-wrong-because.md.
 *
 * The same reason code is shared across every contrast rule; the
 * utility *family* that qualifies as an override varies by rule (text
 * vs. background for text contrast, border / outline / ring for the
 * non-text boundary contrast). The axis lives in the rule, not the
 * reason code — agents read the cited file and figure out which
 * declaration the utility overrides.
 */
export const TAILWIND_CLASS_ON_CONSUMER = "tailwind_class_on_consumer";

/**
 * Utility families that override the *text-vs-background* pair a
 * text-contrast rule checks. `text-*` overrides `color`; `bg-*`
 * overrides `background-color` / `background`. Scoped deliberately —
 * border / outline / ring utilities live in a separate set consumed
 * by `contrast/non-text`.
 */
export const TEXT_CONTRAST_OVERRIDE_FAMILIES: ReadonlySet<string> = new Set(["text", "bg"]);

/**
 * Utility families that override the *boundary-vs-surroundings* pair
 * the non-text contrast rule checks:
 *
 *   - `border-*` (including bare `border`, `border-{color}`,
 *     `border-{width}`, `border-{side}-*`, and `border-[<arbitrary>]`)
 *     — directly overrides the `border` / `border-color` declaration
 *     the rule evaluated.
 *   - `outline-*` — directly overrides the `outline` /
 *     `outline-color` declaration.
 *   - `ring-*` — applies a box-shadow-based boundary on the element.
 *     The non-text rule's intent is "the user-visible boundary of the
 *     control has 3:1 contrast." A ring utility places a visible
 *     boundary on the same element; it's a credible override even
 *     when the failing CSS declared `border-color`. Agent investigates
 *     and decides.
 *
 * `divide-*` is intentionally excluded. It applies borders *between
 * children of a container*, not on the element itself — the non-text
 * rule fires on the failing element (the button, the svg, the `.btn`),
 * not on its container, so `divide-*` on the failing element does not
 * override the boundary the rule evaluated. Including it would dilute
 * the signal with consumer elements whose `divide-*` utility affects
 * unrelated children.
 */
export const NON_TEXT_CONTRAST_OVERRIDE_FAMILIES: ReadonlySet<string> = new Set([
  "border",
  "outline",
  "ring",
]);

/**
 * Walks every JSX and HTML className in the project and returns the
 * set of plain class names that co-occur on an element with a
 * qualifying Tailwind utility from `families`. Variant-scoped
 * utilities (e.g. `md:text-*`, `hover:border-*`) do NOT qualify — they
 * are conditional and can't override the declared CSS at all viewport
 * widths / states. Only unqualified utilities do.
 *
 * This is the same cross-file primitive `focus/outline-visible` uses
 * for its focus-visible ring cross-reference — tokenized via
 * `parseTailwind`, no new parser pass. Deterministic class-token link,
 * never heuristic.
 */
export function collectTailwindOverrideClasses(
  ctx: ProjectContext,
  families: ReadonlySet<string> = TEXT_CONTRAST_OVERRIDE_FAMILIES,
): ReadonlySet<string> {
  const usage = new Set<string>();
  for (const file of ctx.files) {
    indexFileForTailwindOverride(file.ast, file.language, families, usage);
  }
  return usage;
}

function indexFileForTailwindOverride(
  ast: unknown,
  language: Language,
  families: ReadonlySet<string>,
  usage: Set<string>,
): void {
  if (language === "tsx" || language === "jsx" || language === "ts" || language === "js") {
    for (const el of walkJsxElements(ast as TsxModule)) {
      indexClassStringForOverride(jsxClassString(el), families, usage);
    }
    return;
  }
  if (language === "html") {
    for (const el of walkHtmlElements(ast as HtmlDocument)) {
      indexClassStringForOverride(htmlClassString(el), families, usage);
    }
  }
}

function indexClassStringForOverride(
  classString: string | null,
  families: ReadonlySet<string>,
  usage: Set<string>,
): void {
  if (!classString) return;
  const tokens = parseTailwind(classString);
  const plainClasses: string[] = [];
  let qualifies = false;
  for (const tok of tokens) {
    if (tok.malformed) continue;
    if (tok.variants.length > 0) {
      // Variant-scoped utilities (e.g. `md:text-*`, `hover:bg-*`) are
      // conditional; they can't override the declared CSS at all
      // viewport widths / states. Only unqualified utilities qualify.
      continue;
    }
    if (tok.utility.length === 0) continue;
    plainClasses.push(tok.utility);
    if (isOverridingUtility(tok.utility, families)) qualifies = true;
  }
  if (!qualifies) return;
  for (const cls of plainClasses) usage.add(cls);
}

function isOverridingUtility(utility: string, families: ReadonlySet<string>): boolean {
  const family = utility.split("-")[0] ?? utility;
  return families.has(family);
}

function jsxClassString(element: JsxElement): string | null {
  for (const attr of element.attributes) {
    if (attr.name !== "className" && attr.name !== "class") continue;
    if (!attr.value || attr.value.kind !== "StringLiteral") return null;
    return attr.value.value;
  }
  return null;
}

function htmlClassString(element: HtmlElement): string | null {
  for (const attr of element.attributes) {
    if (attr.name.toLowerCase() === "class") return attr.value ?? null;
  }
  return null;
}

/**
 * First `.<ident>` token in a selector's subject compound. Mirrors the
 * helper in `focus/outline-visible` — compound selectors like
 * `.card.active` cross-reference on `card`. Returns `null` when the
 * selector is bare-element or otherwise not class-scoped.
 */
export function extractPrimarySelectorClass(selector: string): string | null {
  const parts = selector.split(/\s+/);
  const subject = parts[parts.length - 1] ?? selector;
  const head = subject.split(/:(?!:)/)[0] ?? subject;
  return /\.([A-Za-z_][\w-]*)/.exec(head)?.[1] ?? null;
}
