/**
 * Rule: layout/reflow-hardcoded-width
 * Satisfies: wcag22:1.4.10, wcag21:1.4.10
 * Spec: https://www.w3.org/TR/WCAG22/#reflow
 *
 * > Content can be presented without loss of information or
 * > functionality, and without requiring scrolling in two
 * > dimensions, for:
 * >   - Vertical scrolling content at a width equivalent to 320 CSS pixels
 * >   - Horizontal scrolling content at a height equivalent to 256 CSS pixels
 *
 * Flags CSS rules that pin width (or min-width, or max-width) to a
 * px value wider than 320 or that use a fixed pt/in/cm/pc unit. These
 * hardcoded widths commonly break the 320 CSS-px reflow requirement:
 * the element overflows the viewport, forces a horizontal scrollbar,
 * and violates the criterion.
 *
 * Exceptions the rule understands:
 *   - `max-width` is fine at any size (it only caps, it doesn't force)
 *   - widths on `html`, `body`, or viewport-unit values (vw, %) pass
 *   - widths inside `@media (min-width: …)` queries are skipped, since
 *     the author is explicitly scoping the size to a breakpoint
 *
 * v0.0.x: scans standalone .css files. A Phase 5-polish theme
 * resolver will let us catch Tailwind `w-[600px]` arbitrary values.
 */

import { defineRule } from "../../api/plugin.ts";
import { walkCssAtRules, walkCssRules } from "../../engine/ast-helpers.ts";
import type { CssRule as AstCssRule, CssAtRule, CssStylesheet } from "../../types/ast.ts";

const REFLOW_THRESHOLD_PX = 320;
const FIXED_ABSOLUTE_UNITS: ReadonlySet<string> = new Set(["pt", "pc", "in", "cm", "mm"]);
const SKIPPED_SELECTORS: ReadonlySet<string> = new Set(["html", "body", ":root"]);

export const rule = defineRule({
  id: "layout/reflow-hardcoded-width",
  satisfies: ["wcag22:1.4.10", "wcag21:1.4.10"],
  severity: "warning",
  scope: "document",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".css"],
  },
  docs: {
    description:
      "Avoid hardcoded widths wider than 320 CSS pixels — the element will overflow a phone-width viewport and require horizontal scrolling, which violates WCAG 1.4.10 Reflow.",
    rationale:
      "WCAG 1.4.10 requires content to reflow to a 320-pixel-wide viewport without loss of information or horizontal scrolling. A CSS rule that sets `width: 1200px` on a container forces the element to its declared size regardless of viewport, producing a horizontal scrollbar on every phone. Use `max-width` instead, or pair with a media query that scopes the fixed width to a breakpoint wide enough to accommodate it.",
    goodExample: ".container { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }",
    badExample: ".container { width: 1200px; }",
    normativeQuote:
      "Content can be presented without loss of information or functionality, and without requiring scrolling in two dimensions, for a width equivalent to 320 CSS pixels.",
    references: [
      "https://www.w3.org/TR/WCAG22/#reflow",
      "https://www.w3.org/WAI/WCAG22/Techniques/css/C34",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "css") return;
    const stylesheet = ctx.ast as CssStylesheet;
    const skipped = collectBreakpointedRules(stylesheet);
    for (const cssRule of walkCssRules(stylesheet)) {
      if (skipped.has(cssRule)) continue;
      if (isSkippedSelector(cssRule.selector)) continue;
      scanRule(cssRule, ctx);
    }
  },
});

function collectBreakpointedRules(stylesheet: CssStylesheet): Set<AstCssRule> {
  const out = new Set<AstCssRule>();
  for (const at of walkCssAtRules(stylesheet)) {
    if (!isBreakpointScoped(at)) continue;
    for (const r of rulesIn(at)) out.add(r);
  }
  return out;
}

interface RuleCtx {
  emit(v: {
    severity: "warning";
    location: { filePath: string; line: number; column: number };
    message: string;
    suggestion: string;
  }): void;
}

function scanRule(cssRule: AstCssRule, ctx: RuleCtx): void {
  for (const decl of cssRule.declarations) {
    const prop = decl.property.toLowerCase();
    if (prop !== "width" && prop !== "min-width") continue;
    const issue = describeFixedWidth(decl.value);
    if (!issue) continue;
    const value = decl.value.trim();
    ctx.emit({
      severity: "warning",
      location: { filePath: "", line: decl.loc.start.line, column: decl.loc.start.column },
      message: `'${cssRule.selector}' sets ${prop}: ${value} — ${issue} may break WCAG 1.4.10 Reflow at 320px viewports.`,
      suggestion: `Use \`max-width: ${value}\` instead (caps but allows shrinking), or scope the fixed ${prop} inside a \`@media (min-width: ${REFLOW_THRESHOLD_PX}px)\` block so the rule only applies above the reflow threshold.`,
    });
  }
}

function isSkippedSelector(selector: string): boolean {
  return SKIPPED_SELECTORS.has(selector.trim().toLowerCase());
}

function isBreakpointScoped(at: CssAtRule): boolean {
  return at.name.toLowerCase() === "media" && /min-width\s*:/i.test(at.params);
}

function rulesIn(at: CssAtRule): AstCssRule[] {
  const out: AstCssRule[] = [];
  for (const child of at.children) {
    if (child.kind === "CssRule") out.push(child);
    if (child.kind === "CssAtRule") out.push(...rulesIn(child));
  }
  return out;
}

/**
 * Returns a short problem description if the value is a hardcoded
 * width wider than 320px (or uses a fixed physical unit), otherwise
 * returns null.
 */
function describeFixedWidth(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes("var(") || trimmed.includes("calc(")) return null;
  const match = /^([+-]?\d*\.?\d+)(px|pt|pc|in|cm|mm|em|rem|%|vw|vh|ch|auto)?$/.exec(trimmed);
  if (!match) return null;
  const n = Number.parseFloat(match[1] ?? "0");
  const unit = match[2] ?? "px";
  if (!Number.isFinite(n)) return null;
  if (FIXED_ABSOLUTE_UNITS.has(unit)) {
    return `${unit} is a physical unit that doesn't scale with the viewport`;
  }
  if (unit === "px" && n > REFLOW_THRESHOLD_PX) {
    return `a fixed ${n}px width`;
  }
  return null;
}
