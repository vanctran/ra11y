/**
 * Rule: forms/autocomplete-missing
 * Satisfies: wcag22:1.3.5, wcag21:1.3.5
 * Spec: https://www.w3.org/TR/WCAG22/#identify-input-purpose
 *
 * > The purpose of each input field collecting information about the
 * > user can be programmatically determined when:
 * >   - The input field serves a purpose identified in the Input
 * >     Purposes for User Interface Components section; and
 * >   - The content is implemented using technologies with support
 * >     for identifying the expected meaning for form input data.
 *
 * Source: https://www.w3.org/TR/WCAG22/#identify-input-purpose
 *
 * Flags inputs whose `type` or `name`/`id` strongly imply a WCAG 2.1
 * input purpose but that lack an `autocomplete` attribute. Autocomplete
 * values like `email`, `tel`, `name`, `street-address`, `postal-code`
 * let password managers, autofill, and symbol-based input aids do
 * their job — which helps users with cognitive disabilities massively.
 */

import { defineRule } from "../../api/plugin.ts";
import {
  findHtmlElementsByTag,
  findJsxElementsByTag,
  getHtmlAttribute,
  getJsxAttributeString,
  hasHtmlAttribute,
  hasJsxAttribute,
} from "../../engine/ast-helpers.ts";
import type { HtmlDocument, JsxElement, TsxModule } from "../../types/ast.ts";

/**
 * Maps a lowercase input `type` to the autocomplete token we expect.
 * Non-personal types (checkbox, button, submit, hidden, etc.) are
 * omitted — autocomplete doesn't apply to them.
 */
const EXPECTED_BY_TYPE: ReadonlyMap<string, string> = new Map([
  ["email", "email"],
  ["tel", "tel"],
  ["url", "url"],
  ["password", "current-password"],
]);

/**
 * Fallback: when `type` is text/empty, infer purpose from the name or
 * id attribute. Matched as a contains check against lowercase.
 */
const NAME_HEURISTICS: readonly { readonly needle: string; readonly token: string }[] = [
  { needle: "firstname", token: "given-name" },
  { needle: "first_name", token: "given-name" },
  { needle: "lastname", token: "family-name" },
  { needle: "last_name", token: "family-name" },
  { needle: "fullname", token: "name" },
  { needle: "full_name", token: "name" },
  { needle: "username", token: "username" },
  { needle: "email", token: "email" },
  { needle: "phone", token: "tel" },
  { needle: "mobile", token: "tel" },
  { needle: "postalcode", token: "postal-code" },
  { needle: "postal_code", token: "postal-code" },
  { needle: "zipcode", token: "postal-code" },
  { needle: "zip_code", token: "postal-code" },
  { needle: "country", token: "country-name" },
  { needle: "city", token: "address-level2" },
  { needle: "street", token: "street-address" },
  { needle: "address", token: "street-address" },
];

export const rule = defineRule({
  id: "forms/autocomplete-missing",
  satisfies: ["wcag22:1.3.5", "wcag21:1.3.5"],
  severity: "warning",
  scope: "node",
  appliesTo: {
    fileExtensions: [".html", ".htm", ".tsx", ".jsx"],
  },
  docs: {
    description:
      "Input fields collecting personal information (name, email, address, phone) should declare an autocomplete value so browsers and assistive tech can autofill them.",
    rationale:
      "Autocomplete tokens are how password managers, symbol-based input aids, and browser autofill understand what an input is for. Users with cognitive disabilities rely on these aids heavily — an email field without autocomplete='email' turns a one-tap autofill into a manual re-entry.",
    goodExample: `<input type="email" name="email" autocomplete="email">`,
    badExample: `<input type="email" name="email">`,
    normativeQuote:
      "The purpose of each input field collecting information about the user can be programmatically determined.",
    references: [
      "https://www.w3.org/TR/WCAG22/#identify-input-purpose",
      "https://www.w3.org/TR/WCAG21/#input-purposes",
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

type Emit = (v: {
  severity: "error" | "warning" | "info";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
}) => void;

function checkHtml(doc: HtmlDocument, emit: Emit): void {
  for (const input of findHtmlElementsByTag(doc, "input")) {
    if (hasHtmlAttribute(input, "autocomplete")) continue;
    const type = (getHtmlAttribute(input, "type") ?? "text").toLowerCase();
    const name = getHtmlAttribute(input, "name") ?? getHtmlAttribute(input, "id") ?? "";
    const expected = expectedToken(type, name);
    if (!expected) continue;
    emit(buildViolation("input", expected, input.loc.start));
  }
}

function checkJsx(module: TsxModule, emit: Emit): void {
  for (const input of findJsxElementsByTag(module, "input")) {
    checkJsxInput(input, emit);
  }
}

function checkJsxInput(input: JsxElement, emit: Emit): void {
  if (hasJsxAttribute(input, "autoComplete") || hasJsxAttribute(input, "autocomplete")) return;
  const type = (getJsxAttributeString(input, "type") ?? "text").toLowerCase();
  const name = getJsxAttributeString(input, "name") ?? getJsxAttributeString(input, "id") ?? "";
  const expected = expectedToken(type, name);
  if (!expected) return;
  emit(buildViolation("input", expected, input.loc.start));
}

function expectedToken(type: string, nameOrId: string): string | null {
  const fromType = EXPECTED_BY_TYPE.get(type);
  if (fromType) return fromType;
  if (type !== "text" && type !== "" && type !== "search") return null;
  const lowered = nameOrId.toLowerCase().replace(/[^a-z_]/g, "");
  for (const heuristic of NAME_HEURISTICS) {
    if (lowered.includes(heuristic.needle)) return heuristic.token;
  }
  return null;
}

function buildViolation(
  tagName: string,
  expected: string,
  loc: { line: number; column: number },
): {
  severity: "warning";
  location: { filePath: string; line: number; column: number };
  message: string;
  suggestion: string;
} {
  return {
    severity: "warning",
    location: { filePath: "", line: loc.line, column: loc.column },
    message: `<${tagName}> appears to collect personal information but has no autocomplete attribute — password managers and autofill can't identify its purpose.`,
    suggestion: `Add autocomplete="${expected}" so browsers and assistive tech can autofill it. See https://www.w3.org/TR/WCAG21/#input-purposes for the full list of tokens.`,
  };
}
