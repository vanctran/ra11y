/**
 * Candidate finder: review/validation-timing
 * Criteria: wcag22:3.3.3, wcag21:3.3.3, wcag22:3.3.4, wcag21:3.3.4
 * Spec: https://www.w3.org/TR/WCAG22/#error-suggestion
 *       https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data
 *
 * Surfaces JSX `onChange` handlers whose body or referenced identifier
 * looks like it is running validation on every keystroke. Per-keystroke
 * validation can announce errors before the user has finished typing,
 * which WCAG 3.3.3 (Error Suggestion) and 3.3.4 (Error Prevention) care
 * about when the noise leads a user to submit an input they thought was
 * already wrong — the reviewer's call is whether `onBlur` or a
 * submit-time pass would be more appropriate. No auto-downgrade.
 *
 * Detection is intentionally loose (this is a finder, not a rule):
 *   - Inline arrow/function body containing validation-shaped tokens
 *     (`setError(s)?`, `validate*`, `schema.parse`, `.safeParse`,
 *     `throw new`, `yup.`, `zod.`, `isValid`).
 *   - Bare identifier reference whose name matches
 *     /validate|check|verify|errors|schema/i at the handler slot.
 *
 * We do NOT try to resolve identifiers across files, do NOT distinguish
 * "real" from "mock" validation, and do NOT guess whether the field's
 * criterion-of-record (financial / legal / test data per 3.3.4) applies
 * — the agent reading the file does that better than an AST heuristic.
 *
 * Review finder — biased toward false positives. Output is a checklist
 * of places to verify, not a list of failures.
 */

import { defineCandidateFinder } from "../../api/plugin.ts";
import { getJsxAttribute, walkJsxElements } from "../../engine/ast-helpers.ts";
import type { TsxModule } from "../../types/ast.ts";
import type { ReviewCandidate } from "../../types/review.ts";

const CRITERION_IDS = ["wcag22:3.3.3", "wcag21:3.3.3", "wcag22:3.3.4", "wcag21:3.3.4"] as const;

/**
 * Source-text tokens that suggest a handler body is running validation.
 * Each pattern has a short label used in the reason text. The list
 * intentionally overlaps vocabulary (`validate*` plus `isValid`) because
 * finder-tier recall beats dedup. If every pattern matches, we only
 * report the first one — the reason only needs one concrete token.
 */
const VALIDATION_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /\bsetErrors?\s*\(/, label: "setError(s) call" },
  { pattern: /\bvalidate[A-Za-z_$]*\s*\(/, label: "validate*() call" },
  {
    pattern: /\b(?:schema|[A-Za-z_$][\w$]*Schema)\s*\.\s*(?:parse|safeParse)\s*\(/,
    label: "schema.parse/safeParse call",
  },
  { pattern: /\bthrow\s+new\b/, label: "throw new ..." },
  { pattern: /\b(?:yup|zod|joi|z)\s*\.\s*[A-Za-z_$]/, label: "validation-library reference" },
  { pattern: /\bisValid[A-Za-z_$]*\s*\(/, label: "isValid*() call" },
] as const;

/**
 * Identifier-name cues for the bare-reference path. Matches names like
 * `validateEmail`, `checkInput`, `verifyForm`, `setErrors`, `parseSchema`.
 * Case-insensitive and intentionally broad — the agent dismisses in
 * milliseconds, silent-miss is the expensive failure mode.
 */
const VALIDATION_IDENT_RE = /validate|verify|errors?|schema/i;
const CHECK_IDENT_RE = /(^|[^a-z0-9_$])check[A-Z_]/;

const MAX_REF_SNIPPET_LEN = 60;

export const finder = defineCandidateFinder({
  id: "review/validation-timing",
  criterionIds: [...CRITERION_IDS],
  scope: "node",
  appliesTo: { fileExtensions: [".tsx", ".jsx"] },
  docs: {
    description:
      "Surfaces JSX onChange handlers whose body or referenced identifier looks validation-shaped (setError(s), validate*, schema.parse, throw, validation library refs). Reviewer decides whether onBlur or submit-time validation is more appropriate.",
    reviewPrompt:
      "Open the referenced handler (or read the inline body). If it runs validation on every keystroke, consider moving that work to onBlur or submit so errors don't announce before the user has finished typing. WCAG 3.3.3 cares about error-suggestion quality; 3.3.4 cares about reversible / verifiable submission for financial, legal, or test data. Per-keystroke validation is not a spec violation on its own — the question is whether this field's context warrants the noise.",
    references: [
      "https://www.w3.org/TR/WCAG22/#error-suggestion",
      "https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data",
    ],
  },
  find(ctx) {
    const candidates: ReviewCandidate[] = [];
    if (ctx.language === "tsx" || ctx.language === "jsx") {
      findJsxCandidates(ctx.ast as TsxModule, ctx.filePath, candidates);
    }
    return candidates;
  },
});

function findJsxCandidates(root: TsxModule, filePath: string, candidates: ReviewCandidate[]): void {
  for (const el of walkJsxElements(root)) {
    const attr = getJsxAttribute(el, "onChange");
    if (!attr?.value || attr.value.kind !== "Expression") continue;
    const match = detectValidation(attr.value.raw);
    if (!match) continue;
    const reason = buildReason(el.tagName, match);
    for (const criterionId of CRITERION_IDS) {
      candidates.push({
        criterionId,
        location: { filePath, line: el.loc.start.line, column: el.loc.start.column },
        reason,
        // "medium": we have concrete static evidence (a named validation
        // token or an identifier whose name matches the validation-cue
        // regex), but deciding whether onChange is inappropriate here
        // needs the reviewer to see the surrounding field context
        // (optional debounce, financial/legal carve-out, field type).
        confidence: "medium",
      });
    }
  }
}

interface ValidationMatch {
  readonly kind: "inline" | "reference";
  readonly label: string;
  readonly snippet: string;
}

/**
 * Returns a match describing the validation-shape detection, or
 * `undefined` if the handler source shows no validation signal. The
 * inline-body path wins when both paths match — a named token ("schema
 * .parse call") is more specific than an identifier-name cue.
 */
function detectValidation(rawExpression: string): ValidationMatch | undefined {
  const inner = stripOuterBraces(rawExpression);
  if (inner.length === 0) return undefined;

  const isReference = looksLikeFunctionReference(inner);

  if (!isReference) {
    for (const { pattern, label } of VALIDATION_PATTERNS) {
      if (pattern.test(inner)) {
        return { kind: "inline", label, snippet: truncate(inner) };
      }
    }
    return undefined;
  }

  // Bare identifier (or dotted property chain) — the body isn't inline,
  // so we only have the name to work with. Match on the identifier
  // vocabulary; dotted chains match on the tail identifier too.
  const tail = referenceTailIdentifier(inner);
  if (tail && (VALIDATION_IDENT_RE.test(tail) || CHECK_IDENT_RE.test(tail))) {
    return { kind: "reference", label: "validation-shaped name", snippet: truncate(inner) };
  }
  return undefined;
}

function buildReason(tag: string, match: ValidationMatch): string {
  if (match.kind === "inline") {
    return `onChange on <${tag}> has ${match.label} in body — verify whether onBlur is more appropriate (WCAG 3.3.3 / 3.3.4)`;
  }
  return `onChange on <${tag}> passes "${match.snippet}" (${match.label}) — open the handler and verify whether onBlur is more appropriate (WCAG 3.3.3 / 3.3.4)`;
}

/**
 * Strips the outer JSX expression braces the TSX parser captures as
 * part of an attribute's `.raw`.
 */
function stripOuterBraces(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * True when the handler expression looks like a bare identifier
 * reference (`onChange={handleChange}`) or property access
 * (`onChange={this.handleChange}`). Arrow / function-expression bodies
 * are not references — their source is already inline.
 */
function looksLikeFunctionReference(trimmed: string): boolean {
  if (trimmed.length === 0) return false;
  if (trimmed.includes("=>")) return false;
  if (/\bfunction\b/.test(trimmed)) return false;
  return /^[$_A-Za-z][\w$]*(?:\.[$_A-Za-z][\w$]*)*(?:\([^)]*\))?$/.test(trimmed);
}

/**
 * Returns the tail identifier of a (possibly dotted) reference
 * expression — `this.handleChange` → `handleChange`, `validateEmail`
 * → `validateEmail`. Trailing `.bind(...)` / `.call(...)` are stripped
 * so we match on the underlying name.
 */
function referenceTailIdentifier(reference: string): string | undefined {
  // Strip a single optional trailing invocation like `.bind(this)` or
  // `.call(...)` so we can match on the underlying name.
  const withoutCall = reference.replace(/\s*\([^)]*\)\s*$/, "");
  const parts = withoutCall.split(".");
  const tail = parts[parts.length - 1]?.trim();
  return tail && tail.length > 0 ? tail : undefined;
}

function truncate(source: string): string {
  if (source.length <= MAX_REF_SNIPPET_LEN) return source;
  return `${source.slice(0, MAX_REF_SNIPPET_LEN - 1)}…`;
}
