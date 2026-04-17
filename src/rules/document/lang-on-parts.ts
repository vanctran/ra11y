/**
 * Rule: document/lang-on-parts
 * Satisfies: wcag22:3.1.2, wcag21:3.1.2
 * Spec: https://www.w3.org/TR/WCAG22/#language-of-parts
 *
 * > The human language of each passage or phrase in the content can be
 * > programmatically determined, except for proper names, technical
 * > terms, words of indeterminate language, and words or phrases that
 * > have become part of the vernacular of the immediately surrounding
 * > text.
 *
 * Source: https://www.w3.org/TR/WCAG22/#language-of-parts
 *
 * Detecting *missing* lang on a foreign-language passage requires NLP
 * we deliberately don't ship. What we *can* do statically and with
 * zero false positives is validate the shape of any author-supplied
 * `lang` / `xml:lang` attribute on a non-`<html>` element.
 *
 * The 3.1.1 (Language of Page) checker — `document/lang-attribute` —
 * already handles the root `<html>` element, so this rule deliberately
 * skips it to avoid double-reporting.
 *
 * BCP 47 in full is non-trivial (RFC 5646 grammar with extlangs,
 * scripts, regions, variants, extensions, private-use). We use a
 * loose, permissive shape check that catches the four common author
 * mistakes:
 *   1. Empty value (`lang=""`) — provides no signal at all.
 *   2. Underscore separator (`lang="en_US"`) — copy-pasted from a
 *      POSIX locale; browsers do not normalise it, so AT cannot match.
 *   3. Uppercase primary subtag (`lang="EN"`) — browsers tolerate it
 *      but the canonical form (BCP 47 §2.1.1) is lowercase. Flagged
 *      as a warning, not an error.
 *   4. Subtags that aren't 1-8 alphanumeric characters
 *      (`lang="xyz_123"`, `lang="english"`).
 */

import { defineRule } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  getJsxAttributeString,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, JsxElement, TsxModule } from "../../types/ast.ts";

export const rule = defineRule({
  id: "document/lang-on-parts",
  satisfies: ["wcag22:3.1.2", "wcag21:3.1.2"],
  severity: "error",
  scope: "node",
  fixClass: "mechanical",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Validates the BCP 47 shape of `lang` and `xml:lang` attributes on non-`<html>` elements. Detecting missing lang on foreign passages requires natural-language analysis; flagging malformed tags is the high-signal subset that can be checked statically.",
    rationale:
      "Screen readers switch pronunciation dictionaries based on the lang attribute. A malformed tag (`en_US`, empty string, `english`) silently fails to match any installed dictionary, so the wrong voice continues reading the passage. Authors usually intend a real language code; flagging the shape catches copy-paste mistakes from POSIX locales and typos before they ship.",
    goodExample: `<p>The French phrase <span lang="fr">c'est la vie</span> means "that's life".</p>`,
    badExample: `<p>The French phrase <span lang="fr_FR">c'est la vie</span> means "that's life".</p>`,
    normativeQuote:
      "The human language of each passage or phrase in the content can be programmatically determined, except for proper names, technical terms, words of indeterminate language, and words or phrases that have become part of the vernacular of the immediately surrounding text.",
    references: [
      "https://www.w3.org/TR/WCAG22/#language-of-parts",
      "https://www.w3.org/WAI/WCAG22/Techniques/html/H58",
      "https://www.rfc-editor.org/rfc/rfc5646",
    ],
  },
  check(ctx) {
    if (ctx.language === "html") {
      checkHtml(ctx.ast as HtmlDocument, (v) => ctx.emit(v));
    } else if (
      ctx.language === "tsx" ||
      ctx.language === "jsx" ||
      ctx.language === "ts" ||
      ctx.language === "js"
    ) {
      checkJsx(ctx.ast as TsxModule, (v) => ctx.emit(v));
    }
  },
});

type Severity = "error" | "warning" | "info";
type Emit = (v: {
  severity: Severity;
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

const ATTR_NAMES = ["lang", "xml:lang"] as const;

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const el of walkHtmlElements(doc)) {
    if (el.tagName.toLowerCase() === "html") continue;
    for (const attrName of ATTR_NAMES) {
      const value = getHtmlAttribute(el, attrName);
      if (value === null) continue;
      const issue = evaluateLang(value);
      if (issue === null) continue;
      emit(
        buildViolation(el.tagName.toLowerCase(), attrName, value, issue, {
          line: el.loc.start.line,
          column: el.loc.start.column,
        }),
      );
    }
  }
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const el of walkJsxElements(module)) {
    // Skip <html> in JSX too (e.g. Next.js _document.tsx).
    if (el.tagName.toLowerCase() === "html") continue;
    for (const attrName of ATTR_NAMES) {
      checkJsxAttr(el, attrName, emit);
    }
  }
}

function checkJsxAttr(el: JsxElement, attrName: (typeof ATTR_NAMES)[number], emit: Emit): void {
  // JSX uses xmlLang, not xml:lang — but xml:lang is also legal via
  // the JSX namespace syntax. Try both surface forms.
  const candidates = attrName === "xml:lang" ? ["xml:lang", "xmlLang"] : [attrName];
  for (const candidate of candidates) {
    const attr = getJsxAttribute(el, candidate);
    if (attr === null) continue;
    // Expression-valued lang ({locale}) — trust the dev.
    if (attr.value?.kind !== "StringLiteral") continue;
    const value = getJsxAttributeString(el, candidate);
    if (value === null) continue;
    const issue = evaluateLang(value);
    if (issue === null) continue;
    emit(
      buildViolation(el.tagName, attrName, value, issue, {
        line: el.loc.start.line,
        column: el.loc.start.column,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// BCP 47 shape evaluation
// ---------------------------------------------------------------------------

type LangIssue =
  | { readonly kind: "empty" }
  | { readonly kind: "underscore" }
  | { readonly kind: "uppercase-primary"; readonly canonical: string }
  | { readonly kind: "malformed"; readonly reason: string };

const SUBTAG_RE = /^[A-Za-z0-9]{1,8}$/;
const PRIMARY_RE = /^[A-Za-z]{2,3}$/;
const PRIVATE_RE = /^[xX]$/;

/**
 * Returns null if `value` is a plausible BCP 47 tag in canonical form;
 * otherwise returns a `LangIssue` describing why it isn't.
 *
 * This is intentionally permissive — we only flag tags that are
 * unambiguously broken or non-canonical. The IANA registry is huge
 * and shipping it would violate the zero-dependency invariant.
 */
function evaluateLang(raw: string): LangIssue | null {
  const value = raw.trim();
  if (value.length === 0) return { kind: "empty" };
  if (value.includes("_")) return { kind: "underscore" };

  const subtags = value.split("-");
  const primary = subtags[0] ?? "";

  if (PRIVATE_RE.test(primary)) {
    return evaluatePrivateUse(subtags);
  }

  if (!PRIMARY_RE.test(primary)) {
    return {
      kind: "malformed",
      reason: `primary subtag '${primary}' must be 2-3 letters (ISO 639-1/2)`,
    };
  }

  if (primary !== primary.toLowerCase()) {
    return { kind: "uppercase-primary", canonical: canonicalize(value) };
  }

  return validateSubtags(subtags, 1);
}

function evaluatePrivateUse(subtags: readonly string[]): LangIssue | null {
  if (subtags.length < 2) {
    return { kind: "malformed", reason: "private-use tag 'x' must be followed by a subtag" };
  }
  return validateSubtags(subtags, 1);
}

function validateSubtags(subtags: readonly string[], from: number): LangIssue | null {
  for (let i = from; i < subtags.length; i++) {
    const sub = subtags[i] ?? "";
    if (!SUBTAG_RE.test(sub)) {
      return { kind: "malformed", reason: `subtag '${sub}' is not 1-8 alphanumeric characters` };
    }
  }
  return null;
}

/**
 * Apply BCP 47 §2.1.1 canonical casing: language lowercase, script
 * Title-case, region uppercase, variants lowercase. Used in the
 * suggestion text only — we don't auto-fix.
 */
function canonicalize(value: string): string {
  const subtags = value.split("-");
  return subtags
    .map((sub, i) => {
      if (i === 0) return sub.toLowerCase();
      if (sub.length === 4 && /^[A-Za-z]{4}$/.test(sub)) {
        return sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase();
      }
      if (sub.length === 2 && /^[A-Za-z]{2}$/.test(sub)) return sub.toUpperCase();
      return sub.toLowerCase();
    })
    .join("-");
}

// ---------------------------------------------------------------------------
// Violation construction
// ---------------------------------------------------------------------------

function buildViolation(
  tagName: string,
  attrName: string,
  value: string,
  issue: LangIssue,
  loc: { line: number; column: number },
): {
  severity: Severity;
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  const subject = `<${tagName} ${attrName}="${value}">`;
  switch (issue.kind) {
    case "empty":
      return {
        severity: "error",
        location: { filePath: "", line: loc.line, column: loc.column },
        message: `${subject} is empty — an empty ${attrName} provides no language signal to assistive technology.`,
        suggestion: `Either remove the ${attrName} attribute (so the element inherits the page language) or set a valid BCP 47 tag for the passage's language, e.g. ${attrName}="en" or ${attrName}="fr-CA".`,
      };
    case "underscore":
      return {
        severity: "error",
        location: { filePath: "", line: loc.line, column: loc.column },
        message: `${subject} uses an underscore separator — BCP 47 requires hyphens, so screen readers will fail to match the language.`,
        suggestion: `Replace underscores with hyphens: ${attrName}="${value.replace(/_/g, "-")}".`,
      };
    case "uppercase-primary":
      return {
        severity: "warning",
        location: { filePath: "", line: loc.line, column: loc.column },
        message: `${subject} uses an uppercase primary subtag — browsers accept it, but the canonical BCP 47 form is lowercase for the language subtag.`,
        suggestion: `Lowercase the language subtag: ${attrName}="${issue.canonical}".`,
      };
    case "malformed":
      return {
        severity: "error",
        location: { filePath: "", line: loc.line, column: loc.column },
        message: `${subject} is not a valid BCP 47 tag: ${issue.reason}.`,
        suggestion: `Use an ISO 639-1 two-letter code (e.g. "en", "fr", "ja") or an ISO 639-2 three-letter code, optionally followed by a region (e.g. "en-GB", "zh-Hans"). See https://www.rfc-editor.org/rfc/rfc5646.`,
      };
  }
}
