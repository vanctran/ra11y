/**
 * Rule: focus/outline-visible
 * Satisfies: wcag22:2.4.7, wcag21:2.4.7
 * Spec: https://www.w3.org/TR/WCAG22/#focus-visible
 *
 * > Any keyboard operable user interface has a mode of operation where
 * > the keyboard focus indicator is visible.
 *
 * Flags CSS rules that set `outline: none`/`0` or `outline-style: none`
 * on `:focus`/`:focus-visible` without a replacement focus indicator in
 * the same rule block.
 *
 * Cross-file Tailwind cross-reference (info-severity only):
 *   Class-scoped selectors that would downgrade to `info` are auto-
 *   resolved when the SAME className appears on a JSX/HTML element that
 *   also carries a `focus-visible:ring-*` / `focus-visible:outline-*` /
 *   `focus-visible:shadow-*` Tailwind utility. This is a deterministic
 *   class-token link — NOT heuristic suppression (CLAUDE.md §1). A
 *   looser match (`focus:ring-*`, `hover:ring-*`, or "visually similar"
 *   classes) is NOT allowed here: only the literal `focus-visible:`
 *   variant qualifies, because only that variant is an author-chosen
 *   statement that this element has a focus-visible indicator. One
 *   element is sufficient evidence; no numeric / filename thresholds.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findCssDeclaration,
  walkCssRules,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import { parseTailwind } from "../../input/parsers/tailwind.ts";
import type {
  CssRule,
  CssStylesheet,
  HtmlDocument,
  HtmlElement,
  JsxElement,
  TsxModule,
} from "../../types/ast.ts";
import type { EmittedViolation, Language, ProjectContext } from "../../types/rule.ts";

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

const FOCUS_PSEUDO_PATTERN = /:focus(?:-visible)?\b/;

/**
 * Utility families that compensate for a removed native focus ring.
 * `focus:` / `hover:` variants do NOT count — different user state, not
 * an author statement about focus-visible.
 */
const FOCUS_UTILITY_FAMILIES: ReadonlySet<string> = new Set(["ring", "outline", "shadow"]);

export const rule = defineRule({
  id: "focus/outline-visible",
  satisfies: ["wcag22:2.4.7", "wcag21:2.4.7"],
  severity: "error",
  scope: "project",
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
  afterProject(ctx) {
    const usage = collectFocusVisibleClassUsage(ctx);
    for (const file of ctx.files) {
      if (file.language !== "css") continue;
      for (const cssRule of walkCssRules(file.ast as CssStylesheet)) {
        emitIfMissingIndicator(cssRule, file.filePath, usage, (v) => ctx.emit(v));
      }
    }
  },
});

type ClassSet = ReadonlySet<string>;
type Emit = (v: EmittedViolation) => void;

function emitIfMissingIndicator(
  cssRule: CssRule,
  filePath: string,
  usage: ClassSet,
  emit: Emit,
): void {
  if (!FOCUS_PSEUDO_PATTERN.test(cssRule.selector)) return;
  if (!removesOutline(cssRule)) return;
  if (hasReplacementIndicator(cssRule)) return;

  const scoped = isScopedSelector(cssRule.selector);
  if (scoped) {
    // Deterministic class-token link, not a heuristic: the exact
    // className from the CSS selector appears on an element that also
    // carries a `focus-visible:ring|outline|shadow-*` utility.
    const className = extractPrimaryClass(cssRule.selector);
    if (className !== null && usage.has(className)) return;
  }
  emit({
    severity: scoped ? "info" : "error",
    location: { filePath, line: cssRule.loc.start.line, column: cssRule.loc.start.column },
    message: buildMessage(cssRule.selector),
    suggestion: buildSuggestion(cssRule.selector),
  });
}

/** True if the selector targets a specific class, id, or attribute — not a bare element. */
function isScopedSelector(selector: string): boolean {
  const base = selector.replace(/:focus(-visible)?\b/g, "").trim();
  return base.includes(".") || base.includes("#") || base.includes("[");
}

/**
 * First `.<ident>` token in the selector's subject compound. Compound
 * selectors like `.card.active:focus-visible` cross-reference on `card`.
 */
function extractPrimaryClass(selector: string): string | null {
  const parts = selector.split(/\s+/);
  const subject = parts[parts.length - 1] ?? selector;
  const head = subject.split(/:(?!:)/)[0] ?? subject;
  return /\.([A-Za-z_][\w-]*)/.exec(head)?.[1] ?? null;
}

function removesOutline(cssRule: CssRule): boolean {
  const outline = findCssDeclaration(cssRule, "outline");
  if (outline) {
    const v = outline.value.trim().toLowerCase();
    if (v === "none" || v === "0" || v === "0px") return true;
  }
  const outlineStyle = findCssDeclaration(cssRule, "outline-style");
  return outlineStyle?.value.trim().toLowerCase() === "none";
}

/** Same rule block provides a visible alternative (box-shadow, border, later outline, …). */
function hasReplacementIndicator(cssRule: CssRule): boolean {
  if (hasNonNoneOutlineLater(cssRule)) return true;
  for (const indicator of REPLACEMENT_INDICATORS) {
    if (findCssDeclaration(cssRule, indicator) !== undefined) return true;
  }
  return false;
}

/** Handles the `outline: none; outline: 2px solid blue;` reset-then-replace pattern. */
function hasNonNoneOutlineLater(cssRule: CssRule): boolean {
  let sawNone = false;
  for (const decl of cssRule.declarations) {
    if (decl.property.toLowerCase() !== "outline") continue;
    const val = decl.value.trim().toLowerCase();
    if (val === "none" || val === "0" || val === "0px") sawNone = true;
    else if (sawNone) return true;
  }
  return false;
}

/**
 * Walk every JSX/HTML className in the project; return the set of plain
 * class names that co-occur on an element with a qualifying
 * `focus-visible:ring|outline|shadow-*` utility. Uses existing
 * `parseTailwind` tokenizer output — no new parser pass.
 */
function collectFocusVisibleClassUsage(ctx: ProjectContext): ClassSet {
  const usage = new Set<string>();
  for (const file of ctx.files) indexFile(file.ast, file.language, usage);
  return usage;
}

function indexFile(ast: unknown, language: Language, usage: Set<string>): void {
  if (language === "tsx" || language === "jsx" || language === "ts" || language === "js") {
    for (const el of walkJsxElements(ast as TsxModule)) indexClassString(jsxClassString(el), usage);
    return;
  }
  if (language === "html") {
    for (const el of walkHtmlElements(ast as HtmlDocument))
      indexClassString(htmlClassString(el), usage);
  }
}

function indexClassString(classString: string | null, usage: Set<string>): void {
  if (!classString) return;
  const { plainClasses, qualifies } = partitionTokens(parseTailwind(classString));
  if (!qualifies) return;
  for (const cls of plainClasses) usage.add(cls);
}

function partitionTokens(
  tokens: readonly { variants: readonly string[]; utility: string; malformed: boolean }[],
): { plainClasses: string[]; qualifies: boolean } {
  const plainClasses: string[] = [];
  let qualifies = false;
  for (const tok of tokens) {
    if (tok.malformed) continue;
    if (tok.variants.length === 0) {
      if (tok.utility.length > 0) plainClasses.push(tok.utility);
      continue;
    }
    if (isFocusVisibleIndicator(tok.variants, tok.utility)) qualifies = true;
  }
  return { plainClasses, qualifies };
}

function isFocusVisibleIndicator(variants: readonly string[], utility: string): boolean {
  if (!variants.includes("focus-visible")) return false;
  const family = utility.split("-")[0] ?? utility;
  return FOCUS_UTILITY_FAMILIES.has(family);
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

function buildMessage(selector: string): string {
  return `'${selector}' removes the focus outline without a replacement indicator — keyboard users won't see which element is focused.`;
}

function buildSuggestion(selector: string): string {
  const base = `Add a visible focus indicator to '${selector}'. Replace \`outline: none\` with a custom outline (e.g., \`outline: 2px solid #0066cc\`), or add \`box-shadow: 0 0 0 2px #0066cc\` as an alternative. If you're resetting only to re-style, keep the replacement in the same rule block.`;
  if (isScopedSelector(selector)) {
    return `${base} If this element uses Tailwind's \`focus-visible:ring-*\` or \`focus-visible:outline-*\` classes on the component, the focus indicator is already provided — suppress this note by adding \`/* ra11y-disable-next-line focus/outline-visible */\` on the line above the CSS rule (or \`/* ra11y-disable focus/outline-visible */\` at the top of the file). Criterion-level pragmas (\`wcag22:2.4.7\`) work too.`;
  }
  return base;
}
