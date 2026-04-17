/**
 * Candidate finder: review/redundant-entry
 * Criteria: wcag22:3.3.7
 * Spec: https://www.w3.org/TR/WCAG22/#redundant-entry
 *
 * Flags repeated input purposes inside a single form when a later
 * text-entry input duplicates an earlier one by literal autocomplete,
 * type="email", same personal-data-ish name, or same associated label
 * text. WCAG 2.2 scopes this to an entire process; this finder uses a
 * same-form proxy with a strong static signal.
 *
 * Review finder - biased toward false positives.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import {
  getHtmlAttribute,
  getJsxAttribute,
  htmlTextContent,
  jsxTextContent,
  walkHtmlElements,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type {
  HtmlDocument,
  HtmlElement,
  JsxAttributeValue,
  JsxElement,
  TsxModule,
} from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = ["wcag22:3.3.7"] as const;

const PERSONAL_DATA_HINT =
  /\b(?:name|first|last|full|email|e-mail|mail|phone|tel|mobile|company|organization|org|address|street|city|state|province|region|country|zip|postal|postcode)\b/i;

const EXCLUDED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "password",
  "radio",
  "range",
  "reset",
  "submit",
]);

interface InputInfo {
  readonly autocomplete: string | null;
  readonly emailType: string | null;
  readonly label: string | null;
  readonly line: number;
  readonly name: string | null;
  readonly column: number;
}

interface DuplicateSignal {
  readonly detail: string;
}

export const finder = defineCandidateFinder({
  id: "review/redundant-entry",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".html", ".htm", ".tsx", ".jsx"] },
  docs: {
    description:
      'Finds later text-entry inputs inside a single form that appear to request the same information as an earlier input via duplicate autocomplete, type="email", name, or label text.',
    reviewPrompt:
      "Verify that this repeated field truly needs fresh entry. If it asks for information already provided earlier in the process, pre-populate it, show it read-only, or offer a 'Same as...' reuse option. Re-entry can still be acceptable when it is essential or security-sensitive.",
    references: [
      "https://www.w3.org/TR/WCAG22/#redundant-entry",
      "https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    if (ctx.language === "html") {
      findHtmlCandidates(ctx.ast as HtmlDocument, ctx.filePath, candidates);
    } else if (ctx.language === "tsx" || ctx.language === "jsx") {
      findJsxCandidates(ctx.ast as TsxModule, ctx.filePath, candidates);
    }
    return candidates;
  },
});

function findHtmlCandidates(
  root: HtmlDocument,
  filePath: string,
  candidates: ReviewCandidate[],
): void {
  for (const form of walkHtmlElements(root)) {
    if (form.tagName.toLowerCase() !== "form") continue;
    emitFormDuplicates(filePath, collectHtmlInputs(form), candidates);
  }
}

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const form of walkJsxElements(root)) {
    if (form.tagName !== "form") continue;
    emitFormDuplicates(filePath, collectJsxInputs(form), candidates);
  }
}

interface HtmlLabelIndex {
  readonly byId: Map<string, string>;
  readonly nested: Map<HtmlElement, string>;
}

interface JsxLabelIndex {
  readonly byId: Map<string, string>;
  readonly nested: Map<JsxElement, string>;
}

function collectHtmlInputs(form: HtmlElement): readonly InputInfo[] {
  const labels = indexHtmlLabels(form);
  const out: InputInfo[] = [];
  for (const el of walkHtmlElements(form)) {
    if (!isRelevantHtmlInput(el)) continue;
    const id = normalizeToken(getHtmlAttribute(el, "id"));
    const label = (id ? labels.byId.get(id) : undefined) ?? labels.nested.get(el) ?? null;
    out.push(buildHtmlInputInfo(el, label));
  }
  return out;
}

function indexHtmlLabels(form: HtmlElement): HtmlLabelIndex {
  const byId = new Map<string, string>();
  const nested = new Map<HtmlElement, string>();
  for (const el of walkHtmlElements(form)) {
    if (el.tagName.toLowerCase() !== "label") continue;
    const label = normalizeLabelText(htmlTextContent(el));
    if (!label) continue;
    const htmlFor = normalizeToken(getHtmlAttribute(el, "for"));
    if (htmlFor) setIfMissing(byId, htmlFor, label);
    for (const child of walkHtmlElements(el)) {
      if (!isRelevantHtmlInput(child)) continue;
      setIfMissing(nested, child, label);
    }
  }
  return { byId, nested };
}

function buildHtmlInputInfo(el: HtmlElement, label: string | null): InputInfo {
  return {
    autocomplete: normalizeAutocomplete(getHtmlAttribute(el, "autocomplete")),
    emailType: htmlEmailType(el),
    label,
    line: el.loc.start.line,
    name: normalizeName(getHtmlAttribute(el, "name")),
    column: el.loc.start.column,
  };
}

function collectJsxInputs(form: JsxElement): readonly InputInfo[] {
  const labels = indexJsxLabels(form);
  const out: InputInfo[] = [];
  for (const el of walkJsxDescendants(form)) {
    if (!isRelevantJsxInput(el)) continue;
    const id = normalizeToken(getLiteralJsxAttribute(el, "id"));
    const label = (id ? labels.byId.get(id) : undefined) ?? labels.nested.get(el) ?? null;
    out.push(buildJsxInputInfo(el, label));
  }
  return out;
}

function indexJsxLabels(form: JsxElement): JsxLabelIndex {
  const byId = new Map<string, string>();
  const nested = new Map<JsxElement, string>();
  for (const el of walkJsxDescendants(form)) {
    if (el.tagName !== "label") continue;
    const label = normalizeLabelText(jsxTextContent(el));
    if (!label) continue;
    const htmlFor = normalizeToken(getLiteralJsxAttribute(el, "htmlFor"));
    if (htmlFor) setIfMissing(byId, htmlFor, label);
    for (const child of walkJsxDescendants(el)) {
      if (!isRelevantJsxInput(child)) continue;
      setIfMissing(nested, child, label);
    }
  }
  return { byId, nested };
}

function buildJsxInputInfo(el: JsxElement, label: string | null): InputInfo {
  return {
    autocomplete: normalizeAutocomplete(getLiteralJsxAttribute(el, "autocomplete")),
    emailType: jsxEmailType(el),
    label,
    line: el.loc.start.line,
    name: normalizeName(getLiteralJsxAttribute(el, "name")),
    column: el.loc.start.column,
  };
}

function emitFormDuplicates(
  filePath: string,
  inputs: readonly InputInfo[],
  candidates: ReviewCandidate[],
): void {
  const seenAutocomplete = new Set<string>();
  const seenEmailTypes = new Set<string>();
  const seenNames = new Set<string>();
  const seenLabels = new Set<string>();

  for (const input of inputs) {
    const signal = detectDuplicateSignal(
      input,
      seenAutocomplete,
      seenEmailTypes,
      seenNames,
      seenLabels,
    );
    if (signal) pushForAllCriteria(candidates, filePath, input.line, input.column, signal.detail);

    if (input.autocomplete) seenAutocomplete.add(input.autocomplete);
    if (input.emailType) seenEmailTypes.add(input.emailType);
    if (input.name) seenNames.add(input.name);
    if (input.label) seenLabels.add(input.label);
  }
}

function detectDuplicateSignal(
  input: InputInfo,
  seenAutocomplete: ReadonlySet<string>,
  seenEmailTypes: ReadonlySet<string>,
  seenNames: ReadonlySet<string>,
  seenLabels: ReadonlySet<string>,
): DuplicateSignal | null {
  if (input.autocomplete && seenAutocomplete.has(input.autocomplete)) {
    return { detail: `autocomplete="${input.autocomplete}"` };
  }
  if (input.emailType && seenEmailTypes.has(input.emailType)) {
    return { detail: `type="${input.emailType}"` };
  }
  if (input.name && seenNames.has(input.name)) {
    return { detail: `name="${input.name}"` };
  }
  if (input.label && seenLabels.has(input.label)) {
    return { detail: `label text "${input.label}"` };
  }
  return null;
}

function isRelevantHtmlInput(el: HtmlElement): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  return !EXCLUDED_INPUT_TYPES.has(htmlInputType(el));
}

function isRelevantJsxInput(el: JsxElement): boolean {
  if (el.tagName !== "input") return false;
  return !EXCLUDED_INPUT_TYPES.has(jsxInputType(el));
}

function htmlInputType(el: HtmlElement): string {
  return normalizeToken(getHtmlAttribute(el, "type")) ?? "text";
}

function jsxInputType(el: JsxElement): string {
  return normalizeToken(getLiteralJsxAttribute(el, "type")) ?? "text";
}

function htmlEmailType(el: HtmlElement): string | null {
  return htmlInputType(el) === "email" ? "email" : null;
}

function jsxEmailType(el: JsxElement): string | null {
  return jsxInputType(el) === "email" ? "email" : null;
}

function normalizeAutocomplete(value: string | null): string | null {
  const normalized = normalizeToken(value);
  if (!normalized || normalized === "on" || normalized === "off") return null;
  return normalized;
}

function normalizeName(value: string | null): string | null {
  const normalized = normalizeToken(value);
  if (!normalized || normalized.endsWith("[]")) return null;
  return looksLikePersonalData(normalized) ? normalized : null;
}

function normalizeLabelText(value: string): string | null {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[:*\s]+$/, "")
    .trim();
  if (!normalized) return null;
  return looksLikePersonalData(normalized) ? normalized : null;
}

function normalizeToken(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function looksLikePersonalData(value: string): boolean {
  const probe = value.replace(/[_.[\]-]+/g, " ");
  return PERSONAL_DATA_HINT.test(probe);
}

function getLiteralJsxAttribute(element: JsxElement, name: string): string | null {
  const attr = getJsxAttribute(element, name);
  if (!attr?.value) return null;
  return jsxLiteralString(attr.value);
}

function jsxLiteralString(value: JsxAttributeValue): string | null {
  if (value.kind === "StringLiteral") return value.value;
  const trimmed = value.raw.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (
    (inner.startsWith('"') && inner.endsWith('"')) ||
    (inner.startsWith("'") && inner.endsWith("'"))
  ) {
    return inner.slice(1, -1);
  }
  return null;
}

function* walkJsxDescendants(root: JsxElement): Iterable<JsxElement> {
  for (const child of root.children) {
    if (child.kind !== "JsxElement") continue;
    yield child;
    yield* walkJsxDescendants(child);
  }
}

function setIfMissing<K>(map: Map<K, string>, key: K, value: string): void {
  if (!map.has(key)) map.set(key, value);
}

function pushForAllCriteria(
  candidates: ReviewCandidate[],
  filePath: string,
  line: number,
  column: number,
  detail: string,
): void {
  const reason = `A prior <input> in the same <form> already uses ${detail} -- verify the user can reuse previously entered information instead of typing it again`;
  for (const criterionId of CRITERION_IDS) {
    // Confidence "low": the "same purpose twice" detection rides on a
    // same-form proxy (not the full "process" the spec scopes on),
    // plus personal-data keyword matching and label-text dedupe. A
    // real redundant entry will match; so will "old password / new
    // password" fields that genuinely need both. Reviewer decides.
    candidates.push({
      criterionId,
      location: { filePath, line, column },
      reason,
      confidence: "low",
    });
  }
}
