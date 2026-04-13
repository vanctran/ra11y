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
 */

import { walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssRule as CssCssRule, CssDeclaration, CssStylesheet } from "../../types/ast.ts";
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
