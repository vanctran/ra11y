/**
 * Rule: parsing/html-has-lang
 * Satisfies: wcag22:3.1.2, wcag21:3.1.2
 * Spec: https://www.w3.org/TR/WCAG22/#language-of-parts
 *
 * > The human language of each passage or phrase in the content can be
 * > programmatically determined except for proper names, technical terms,
 * > words of indeterminate language, and words or phrases that have become
 * > part of the vernacular of the immediately surrounding text.
 *
 * Source: https://www.w3.org/TR/WCAG22/#language-of-parts
 *
 * This rule is complementary to `document/lang-attribute` (3.1.1 Language
 * of Page). That rule flags a missing/empty lang at the document root;
 * this one flags any element whose lang attribute *is* present but is
 * empty or syntactically invalid BCP 47. Wrong language metadata is as
 * harmful as missing — a screen reader that trusts `lang="english"` will
 * fall back to the default voice and mispronounce everything.
 *
 * BCP 47 (RFC 5646) is intentionally flexible; this rule enforces the
 * common subset most humans write by hand: a 2- or 3-letter primary
 * language subtag optionally followed by dash-separated subtags of 1-8
 * alphanumerics each. That matches everything in the IANA registry a
 * typical author would use (en, en-US, zh-Hans, es-419, de-CH-1901,
 * sr-Latn-RS) without trying to mirror the registry itself.
 *
 * Document-scoped. Runs on .html/.htm files only; JSX support can be
 * added later once jsx ast-helpers surface attribute walks as cleanly.
 */

import { defineRule } from "../../api/plugin.ts";
import { walkHtmlElements } from "../../engine/ast-helpers.ts";
import type { HtmlDocument, HtmlElement } from "../../types/ast.ts";

/**
 * Basic BCP 47 syntax:
 *   - primary subtag: 2 or 3 letters (ISO 639-1/2/3)
 *   - zero or more extension subtags, each 1-8 alphanumerics, dash-separated
 * Case-insensitive. Does not validate against the IANA registry.
 */
const BCP47_BASIC = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$/;

export const rule = defineRule({
  id: "parsing/html-has-lang",
  satisfies: ["wcag22:3.1.1", "wcag21:3.1.1", "wcag22:3.1.2", "wcag21:3.1.2"],
  severity: "error",
  scope: "document",
  fixClass: "mechanical",
  appliesTo: {
    fileExtensions: [".html", ".htm"],
  },
  docs: {
    description:
      "Every element that declares a lang attribute must use a syntactically valid, non-empty BCP 47 language tag.",
    rationale:
      'Screen readers switch pronunciation dictionaries based on lang. An empty or malformed value (lang="", lang="english", lang="en_US") is treated as unknown — the assistive technology falls back to the default voice and mispronounces the content, which is indistinguishable from no lang attribute at all.',
    goodExample: `<html lang="en-US"><body><p lang="fr">Bonjour</p></body></html>`,
    badExample: `<html lang="english"><body><p lang="">Some text</p></body></html>`,
    normativeQuote:
      "The human language of each passage or phrase in the content can be programmatically determined except for proper names, technical terms, words of indeterminate language, and words or phrases that have become part of the vernacular of the immediately surrounding text.",
    references: [
      "https://www.w3.org/TR/WCAG22/#language-of-parts",
      "https://www.w3.org/WAI/WCAG22/Techniques/html/H58",
      "https://www.rfc-editor.org/rfc/rfc5646",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "html") return;
    const doc = ctx.ast as HtmlDocument;
    for (const element of walkHtmlElements(doc)) {
      const problem = classifyLang(element);
      if (!problem) continue;
      ctx.emit({
        severity: "error",
        location: {
          filePath: "",
          line: element.loc.start.line,
          column: element.loc.start.column,
        },
        message: problem.message,
        suggestion: problem.suggestion,
      });
    }
  },
});

interface LangProblem {
  readonly message: string;
  readonly suggestion: string;
}

function classifyLang(element: HtmlElement): LangProblem | null {
  const raw = findLangAttribute(element);
  if (raw === null) return null;
  const trimmed = raw.trim();
  const tag = `<${element.tagName}>`;
  if (trimmed.length === 0) {
    return {
      message: `${tag} has an empty lang attribute — screen readers treat this as no language at all and fall back to the default voice.`,
      suggestion: `Set lang to a valid BCP 47 tag that matches this element's content, e.g. lang="en" or lang="en-US". If the ${tag} shouldn't declare a language, remove the attribute entirely so the parent element's lang takes effect.`,
    };
  }
  if (!BCP47_BASIC.test(trimmed)) {
    return {
      message: `${tag} has lang="${raw}" which is not a valid BCP 47 language tag — screen readers will ignore it and fall back to the default voice.`,
      suggestion: buildInvalidSuggestion(raw, trimmed, element.tagName),
    };
  }
  return null;
}

function findLangAttribute(element: HtmlElement): string | null {
  // We walk the raw attribute list (not getHtmlAttribute) because we
  // need to distinguish "attribute absent" from "attribute empty" —
  // getHtmlAttribute returns "" in both the lang="" and the boolean
  // lang cases, and we want to flag both.
  for (const attr of element.attributes) {
    if (attr.name.toLowerCase() === "lang") return attr.value;
  }
  return null;
}

function buildInvalidSuggestion(raw: string, trimmed: string, tagName: string): string {
  const tag = `<${tagName}>`;
  if (raw !== trimmed) {
    return `Remove the surrounding whitespace and use a valid BCP 47 tag on ${tag}, e.g. lang="en" or lang="en-US".`;
  }
  if (trimmed.includes("_")) {
    const dashed = trimmed.replace(/_/g, "-");
    return `BCP 47 separates subtags with dashes, not underscores. Change lang="${raw}" to lang="${dashed}".`;
  }
  const guess = guessBcp47(trimmed);
  if (guess) {
    return `Use the BCP 47 code for this language on ${tag}, e.g. lang="${guess}". Full-word names like "${raw}" are not valid — the primary subtag must be a 2- or 3-letter ISO 639 code.`;
  }
  return `Replace lang="${raw}" on ${tag} with a valid BCP 47 tag: a 2- or 3-letter primary language subtag (optionally followed by dash-separated region/script subtags), e.g. lang="en" or lang="en-US".`;
}

function guessBcp47(value: string): string | null {
  const lowered = value.toLowerCase();
  const known: Record<string, string> = {
    english: "en",
    french: "fr",
    spanish: "es",
    german: "de",
    italian: "it",
    portuguese: "pt",
    japanese: "ja",
    chinese: "zh",
    korean: "ko",
    russian: "ru",
    arabic: "ar",
    dutch: "nl",
    swedish: "sv",
    norwegian: "no",
    danish: "da",
    finnish: "fi",
    polish: "pl",
    turkish: "tr",
    hebrew: "he",
    hindi: "hi",
  };
  return known[lowered] ?? null;
}
