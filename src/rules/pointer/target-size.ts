/**
 * Rule: pointer/target-size
 * Satisfies: wcag22:2.5.8
 * Spec: https://www.w3.org/TR/WCAG22/#target-size-minimum
 *
 * > The size of the target for pointer inputs is at least 24 by 24 CSS
 * > pixels, except where:
 * >   - Spacing: Undersized targets (those less than 24 by 24 CSS pixels)
 * >     are positioned so that if a 24 CSS pixel diameter circle is
 * >     centered on the bounding box of each, the circles do not
 * >     intersect another target or the circle for another undersized
 * >     target;
 * >   - Equivalent: The function can be achieved through a different
 * >     control on the same page that meets this criterion;
 * >   - Inline: The target is in a sentence or its size is otherwise
 * >     constrained by the line-height of non-target text;
 * >   - User agent control: The size of the target is determined by the
 * >     user agent and is not modified by the author;
 * >   - Essential: A particular presentation of the target is essential
 * >     or is legally required for the information being conveyed.
 *
 * New WCAG 2.2 Level AA criterion (NOT in WCAG 2.1).
 *
 * Static-analysis scope: we cannot measure runtime computed size, so
 * we look at *author-declared* size signals only.
 *
 *   1. CSS rules whose selector targets likely-interactive elements
 *      and that pin width/height (or min-width/min-height) below 24px
 *      without compensating padding.
 *   2. JSX/HTML interactive elements (button, role=button, anchor,
 *      input[type=button|submit|checkbox|radio|image]) whose
 *      `className`/`class` Tailwind utilities resolve below 24px, or
 *      whose inline `style` declares too-small dimensions.
 *
 * Skip (no flag):
 *   - Inline interactive elements inside text-flow ancestors (`p`,
 *     `li`, `td`, …) — the WCAG "Inline" exception.
 *   - `<input type="range|color|file|date|…">` (user-agent sized).
 *   - When the same selector also sets compensating padding.
 *
 * Severity is "warning" because the static heuristic cannot verify
 * runtime computed size — only the author's declared intent.
 *
 * Helpers shared between CSS / JSX / HTML branches live in the
 * sibling `target-size-helpers.ts` module.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttributeString,
  walkCssRules,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import { resolveTailwindClasses } from "../../input/resolvers/theme.ts";
import type {
  CssRule as AstCssRule,
  CssDeclaration,
  CssStylesheet,
  HtmlDocument,
  HtmlElement,
  HtmlNode,
  JsxElement,
  JsxNode,
  TsxModule,
} from "../../types/ast.ts";
import type { EmittedViolation, RuleContext } from "../../types/rule.ts";
import {
  applyDeclToBox,
  type BoxResult,
  finalizeBox,
  formatBoxSize,
  MIN_TARGET_PX,
  newBox,
  paddingFromDecl,
  parsePaddingShorthand,
  parsePx,
  truncate,
} from "./target-size-helpers.ts";

/** Tag names that are inherently interactive pointer targets. */
const INTERACTIVE_TAGS: ReadonlySet<string> = new Set(["button", "a"]);

/** input[type=...] values that are pointer-interactive. */
const INTERACTIVE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "image",
]);

/** input[type=...] values where sizing is user-agent-determined per the SC exception. */
const USER_AGENT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "range",
  "color",
  "file",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** Text-flow containers that trigger the WCAG "Inline" exception. */
const TEXT_FLOW_TAGS: ReadonlySet<string> = new Set(["p", "li", "td", "th", "dd", "dt"]);

export const rule = defineRule({
  id: "pointer/target-size",
  satisfies: ["wcag22:2.5.8"],
  severity: "warning",
  scope: "document",
  fixClass: "guidance",
  appliesTo: {
    fileExtensions: [".css", ".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Pointer targets (buttons, links, form controls) must measure at least 24×24 CSS pixels, unless the inline, equivalent, user-agent, or essential exception applies.",
    rationale:
      "Users with motor impairments, tremors, or who use touch input on small screens cannot reliably hit small targets. WCAG 2.2 SC 2.5.8 sets a 24×24 CSS-pixel minimum (with documented exceptions). A button styled `w-4 h-4` (16×16) or `width: 20px; height: 20px;` is too small without compensating padding or the inline-text exception.",
    goodExample:
      '.icon-button { width: 24px; height: 24px; }\n<button className="w-6 h-6">×</button>',
    badExample:
      '.icon-button { width: 16px; height: 16px; }\n<button className="w-4 h-4">×</button>',
    normativeQuote:
      "The size of the target for pointer inputs is at least 24 by 24 CSS pixels, except where: Spacing, Equivalent, Inline, User agent control, or Essential.",
    references: [
      "https://www.w3.org/TR/WCAG22/#target-size-minimum",
      "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html",
    ],
  },
  afterFile(ctx) {
    if (ctx.language === "css") {
      checkCss(ctx as RuleContext & { ast: CssStylesheet });
      return;
    }
    if (ctx.language === "html") {
      checkHtml(ctx as RuleContext & { ast: HtmlDocument });
      return;
    }
    if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx as RuleContext & { ast: TsxModule });
    }
  },
});

// ---------------------------------------------------------------------------
// CSS pass
// ---------------------------------------------------------------------------

interface SizeRead {
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly widthDecl: CssDeclaration | undefined;
  readonly heightDecl: CssDeclaration | undefined;
}

interface PaddingRead {
  readonly horizontalPx: number;
  readonly verticalPx: number;
}

interface SingleAxisRead {
  px: number | null;
  decl: CssDeclaration | undefined;
  isExplicit: boolean;
}

function applyAxisDecl(
  axis: SingleAxisRead,
  decl: CssDeclaration,
  explicit: boolean,
  px: number,
): void {
  if (axis.px === null || (!axis.isExplicit && explicit)) {
    axis.px = px;
    axis.decl = decl;
    axis.isExplicit = explicit;
  }
}

function collectDeclaredSize(cssRule: AstCssRule): SizeRead | null {
  const w: SingleAxisRead = { px: null, decl: undefined, isExplicit: false };
  const h: SingleAxisRead = { px: null, decl: undefined, isExplicit: false };
  for (const decl of cssRule.declarations) {
    const prop = decl.property.toLowerCase();
    const px = parsePx(decl.value);
    if (px === null) continue;
    if (prop === "width" || prop === "min-width") {
      applyAxisDecl(w, decl, prop === "width", px);
    } else if (prop === "height" || prop === "min-height") {
      applyAxisDecl(h, decl, prop === "height", px);
    }
  }
  if (w.px === null && h.px === null) return null;
  return { widthPx: w.px, heightPx: h.px, widthDecl: w.decl, heightDecl: h.decl };
}

function collectPaddingPx(cssRule: AstCssRule): PaddingRead {
  let horizontal = 0;
  let vertical = 0;
  for (const decl of cssRule.declarations) {
    const contribution = paddingFromDecl(decl.property.toLowerCase(), decl.value);
    if (contribution === null) continue;
    horizontal = Math.max(horizontal, contribution.h);
    vertical = Math.max(vertical, contribution.v);
  }
  return { horizontalPx: horizontal, verticalPx: vertical };
}

function isUndersized(size: SizeRead, padding: PaddingRead): boolean {
  const widthEff =
    size.widthPx === null ? Number.POSITIVE_INFINITY : size.widthPx + padding.horizontalPx * 2;
  const heightEff =
    size.heightPx === null ? Number.POSITIVE_INFINITY : size.heightPx + padding.verticalPx * 2;
  return widthEff < MIN_TARGET_PX || heightEff < MIN_TARGET_PX;
}

function checkCss(ctx: RuleContext & { ast: CssStylesheet }): void {
  for (const cssRule of walkCssRules(ctx.ast)) {
    if (!selectorLooksInteractive(cssRule.selector)) continue;
    const size = collectDeclaredSize(cssRule);
    if (size === null) continue;
    const padding = collectPaddingPx(cssRule);
    if (!isUndersized(size, padding)) continue;
    const decl = size.widthDecl ?? size.heightDecl;
    if (decl === undefined) continue;
    const sizeText = formatBoxSize({ widthPx: size.widthPx, heightPx: size.heightPx });
    ctx.emit({
      severity: "warning",
      location: {
        filePath: ctx.filePath,
        line: decl.loc.start.line,
        column: decl.loc.start.column,
      },
      message: `Selector \`${cssRule.selector}\` targets an interactive control sized ${sizeText} — below the WCAG 2.2 SC 2.5.8 minimum of ${MIN_TARGET_PX}×${MIN_TARGET_PX} CSS pixels.`,
      suggestion: buildCssSuggestion(cssRule.selector, size, padding, sizeText),
    });
  }
}

function buildCssSuggestion(
  selector: string,
  size: SizeRead,
  padding: PaddingRead,
  sizeText: string,
): string {
  const w = size.widthPx;
  const h = size.heightPx;
  const needsWidth = w !== null && w < MIN_TARGET_PX;
  const needsHeight = h !== null && h < MIN_TARGET_PX;
  const padDelta =
    Math.max(needsWidth ? MIN_TARGET_PX - w : 0, needsHeight ? MIN_TARGET_PX - h : 0) / 2;
  const fixSize: string[] = [];
  if (needsWidth) fixSize.push(`width: ${MIN_TARGET_PX}px`);
  if (needsHeight) fixSize.push(`height: ${MIN_TARGET_PX}px`);
  const padHint =
    padding.horizontalPx === 0 && padding.verticalPx === 0
      ? `add \`padding: ${Math.ceil(padDelta)}px;\` so the touch target reaches at least ${MIN_TARGET_PX}×${MIN_TARGET_PX}`
      : `increase \`padding\` from the current ${padding.horizontalPx}px/${padding.verticalPx}px so total target reaches ${MIN_TARGET_PX}px on both axes`;
  return `\`${selector}\` declares ${sizeText}. Either set \`${fixSize.join("; ")};\`, or ${padHint}. If this control is inline within a sentence or sized by surrounding line-height, the WCAG 2.2 "Inline" exception applies — suppress with a comment explaining why.`;
}

function selectorLooksInteractive(selector: string): boolean {
  const s = selector.toLowerCase();
  if (/(^|[\s>+~,])(button|a)\b/.test(s)) return true;
  if (
    s.includes('[role="button"]') ||
    s.includes("[role='button']") ||
    s.includes("[role=button]")
  ) {
    return true;
  }
  if (/input\s*\[\s*type\s*=\s*['"]?(button|submit|reset|checkbox|radio|image)['"]?\s*\]/.test(s)) {
    return true;
  }
  if (/(^|[\s.>+~,])(\.btn|\.button|\.icon-btn|\.icon-button)\b/.test(s)) return true;
  if (/[\w-]*button[\w-]*/.test(s) && !s.includes("submit-success")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// JSX pass — Tailwind className resolution on interactive elements
// ---------------------------------------------------------------------------

function checkJsx(ctx: RuleContext & { ast: TsxModule }): void {
  const ancestors = buildJsxAncestorMap(ctx.ast);
  for (const el of walkJsxElements(ctx.ast)) {
    if (!isInteractiveJsx(el)) continue;
    if (jsxIsInsideTextFlow(el, ancestors)) continue;
    const className = getJsxAttributeString(el, "className") ?? getJsxAttributeString(el, "class");
    if (className === null) continue;
    const sized = analyzeTailwindClasses(className);
    if (sized === null) continue;
    ctx.emit(
      buildMarkupViolation(el.tagName, ctx.filePath, el.loc.start, "className", className, sized),
    );
  }
}

function buildJsxAncestorMap(module: TsxModule): Map<JsxElement, JsxElement[]> {
  const out = new Map<JsxElement, JsxElement[]>();
  const visit = (node: JsxNode, stack: JsxElement[]): void => {
    if (node.kind !== "JsxElement") return;
    out.set(node, [...stack]);
    stack.push(node);
    for (const child of node.children) visit(child, stack);
    stack.pop();
  };
  for (const root of module.jsxElements) visit(root, []);
  return out;
}

function jsxIsInsideTextFlow(el: JsxElement, ancestors: Map<JsxElement, JsxElement[]>): boolean {
  const stack = ancestors.get(el) ?? [];
  return stack.some((a) => TEXT_FLOW_TAGS.has(a.tagName.toLowerCase()));
}

function isInteractiveJsx(el: JsxElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (getJsxAttributeString(el, "role") === "button") return true;
  if (tag === "input") return isInteractiveInputType(getJsxAttributeString(el, "type"));
  return false;
}

function isInteractiveInputType(typeAttr: string | null): boolean {
  const type = (typeAttr ?? "text").toLowerCase();
  if (USER_AGENT_INPUT_TYPES.has(type)) return false;
  return INTERACTIVE_INPUT_TYPES.has(type);
}

function analyzeTailwindClasses(className: string): BoxResult | null {
  const decls = resolveTailwindClasses(className);
  if (decls.length === 0) return null;
  const box = newBox();
  for (const d of decls) applyDeclToBox(box, d.property, d.value);
  return finalizeBox(box, className);
}

function buildMarkupViolation(
  tag: string,
  filePath: string,
  pos: { line: number; column: number },
  attr: string,
  raw: string,
  sized: BoxResult,
): EmittedViolation {
  const sizeText = formatBoxSize(sized);
  return {
    severity: "warning",
    location: { filePath, line: pos.line, column: pos.column },
    message: `<${tag} ${attr}="${truncate(raw, 40)}"> resolves to a ${sizeText} pointer target — below the WCAG 2.2 SC 2.5.8 minimum of ${MIN_TARGET_PX}×${MIN_TARGET_PX} CSS pixels.`,
    suggestion: markupFixSuggestion(attr, sized),
  };
}

function markupFixSuggestion(attr: string, sized: BoxResult): string {
  if (attr === "style") {
    return `Increase \`width\` and \`height\` to at least ${MIN_TARGET_PX}px each, or add ~4px of padding on each side so the total touch target reaches ${MIN_TARGET_PX}×${MIN_TARGET_PX} CSS pixels. If this control is inline within prose, the WCAG 2.2 "Inline" exception applies.`;
  }
  const padHint =
    sized.paddingHorizontalPx === 0 && sized.paddingVerticalPx === 0
      ? `, or add \`p-1\` (4px padding) so the total touch area reaches ${MIN_TARGET_PX}×${MIN_TARGET_PX}`
      : "";
  return `Replace the sizing classes with \`w-6 h-6\` (${MIN_TARGET_PX}×${MIN_TARGET_PX} CSS pixels)${padHint}. If this control is inline within prose or its size is constrained by surrounding line-height, the WCAG 2.2 "Inline" exception applies — suppress with a comment explaining why.`;
}

// ---------------------------------------------------------------------------
// HTML pass — `style="..."` and `class="..."` Tailwind
// ---------------------------------------------------------------------------

function checkHtml(ctx: RuleContext & { ast: HtmlDocument }): void {
  const ancestors = buildHtmlAncestorMap(ctx.ast);
  for (const el of walkHtmlElements(ctx.ast)) {
    if (!isInteractiveHtml(el)) continue;
    if (htmlIsInsideTextFlow(el, ancestors)) continue;
    const style = getHtmlAttribute(el, "style");
    if (style !== null) {
      const sized = analyzeInlineStyle(style);
      if (sized !== null) {
        ctx.emit(
          buildMarkupViolation(el.tagName, ctx.filePath, el.loc.start, "style", style, sized),
        );
        continue;
      }
    }
    const className = getHtmlAttribute(el, "class");
    if (className !== null) {
      const sized = analyzeTailwindClasses(className);
      if (sized !== null) {
        ctx.emit(
          buildMarkupViolation(el.tagName, ctx.filePath, el.loc.start, "class", className, sized),
        );
      }
    }
  }
}

function buildHtmlAncestorMap(doc: HtmlDocument): Map<HtmlElement, HtmlElement[]> {
  const out = new Map<HtmlElement, HtmlElement[]>();
  const visit = (node: HtmlNode, stack: HtmlElement[]): void => {
    if (node.kind !== "HtmlElement") return;
    out.set(node, [...stack]);
    stack.push(node);
    for (const child of node.children) visit(child, stack);
    stack.pop();
  };
  for (const child of doc.children) visit(child, []);
  return out;
}

function htmlIsInsideTextFlow(
  el: HtmlElement,
  ancestors: Map<HtmlElement, HtmlElement[]>,
): boolean {
  const stack = ancestors.get(el) ?? [];
  return stack.some((a) => TEXT_FLOW_TAGS.has(a.tagName.toLowerCase()));
}

function isInteractiveHtml(el: HtmlElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (getHtmlAttribute(el, "role") === "button") return true;
  if (tag === "input") return isInteractiveInputType(getHtmlAttribute(el, "type"));
  return false;
}

function analyzeInlineStyle(style: string): BoxResult | null {
  const box = newBox();
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    // padding shorthand needs special handling because applyDeclToBox
    // routes through paddingFromDecl, which already calls parsePaddingShorthand.
    if (prop === "padding") {
      const parsed = parsePaddingShorthand(value);
      if (parsed !== null) {
        box.padH = Math.max(box.padH, parsed.horizontal);
        box.padV = Math.max(box.padV, parsed.vertical);
      }
      continue;
    }
    applyDeclToBox(box, prop, value);
  }
  return finalizeBox(box, style);
}
