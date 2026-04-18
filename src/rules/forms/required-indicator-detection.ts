/**
 * Detection helpers for `forms/required-indicator-missing`.
 *
 * Separated from the rule module to keep each file reviewable under the
 * commit-size cap. See the rule file for spec citations and rationale.
 */

import {
  getJsxAttribute,
  getJsxAttributeString,
  walkJsxElements,
} from "../../engine/ast-helpers.ts";
import type { JsxElement, TsxModule } from "../../types/ast.ts";

/** Native form controls whose `required` attribute triggers this check. */
const NATIVE_REQUIREABLE_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select"]);

/** Max characters to scan for a component's opening brace after its signature. */
const COMPONENT_BODY_LOOKAHEAD = 400;

const COMPONENT_WITH_REQUIRED_PROP =
  /(?:function\s+([A-Z]\w*)\s*(?:<[^>]*>)?\s*\(\s*\{[^}]*?\brequired\b[^}]*?\}|(?:const|let|var)\s+([A-Z]\w*)(?:\s*:\s*[^=\n]+?)?\s*=\s*(?:React\.)?(?:forwardRef[^(]*\()?\s*(?:function\s*\w*\s*)?\(\s*\{[^}]*?\brequired\b[^}]*?\})/g;

interface ComponentSite {
  readonly name: string;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly nameOffset: number;
}

export interface Finding {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly suggestion: string;
}

export function analyze(source: string, module: TsxModule): readonly Finding[] {
  const findings: Finding[] = [];
  for (const site of findComponentSites(source)) {
    const forwarded = findForwardedNative(module, site);
    if (!forwarded) continue;
    if (hasAriaRequired(module, site)) continue;
    if (hasVisibleIndicator(source, module, site)) continue;
    findings.push(buildFinding(source, site, forwarded));
  }
  return findings;
}

function findComponentSites(source: string): readonly ComponentSite[] {
  const sites: ComponentSite[] = [];
  COMPONENT_WITH_REQUIRED_PROP.lastIndex = 0;
  let m: RegExpExecArray | null = COMPONENT_WITH_REQUIRED_PROP.exec(source);
  while (m !== null) {
    const name = m[1] ?? m[2] ?? "";
    if (name.length > 0) {
      const site = resolveBody(source, m.index, name);
      if (site) sites.push(site);
    }
    m = COMPONENT_WITH_REQUIRED_PROP.exec(source);
  }
  return sites;
}

function resolveBody(source: string, matchStart: number, name: string): ComponentSite | null {
  const paramsCloseParen = findParamsCloseParen(source, matchStart);
  if (paramsCloseParen === -1) return null;
  const bodyOpen = findBodyOpenBrace(source, paramsCloseParen + 1);
  if (bodyOpen === -1) return null;
  const bodyClose = matchBrace(source, bodyOpen);
  if (bodyClose === -1) return null;
  const nameOffset = source.indexOf(name, matchStart);
  return {
    name,
    bodyStart: bodyOpen + 1,
    bodyEnd: bodyClose,
    nameOffset: nameOffset === -1 ? matchStart : nameOffset,
  };
}

function findParamsCloseParen(source: string, from: number): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === "(") return matchParen(source, i);
    i++;
    if (i - from > COMPONENT_BODY_LOOKAHEAD) return -1;
  }
  return -1;
}

function findBodyOpenBrace(source: string, from: number): number {
  let i = from;
  const end = Math.min(source.length, from + COMPONENT_BODY_LOOKAHEAD);
  while (i < end) {
    const ch = source[i] ?? "";
    if (ch === "{") return i;
    if (ch === ";") return -1;
    if (ch === "(" && source.slice(Math.max(0, i - 4), i).includes("=>")) {
      const close = matchParen(source, i);
      if (close === -1) return -1;
      return -1;
    }
    i++;
  }
  return -1;
}

function matchParen(source: string, openIdx: number): number {
  return matchBalanced(source, openIdx, "(", ")");
}

function matchBrace(source: string, openIdx: number): number {
  return matchBalanced(source, openIdx, "{", "}");
}

function matchBalanced(source: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i] ?? "";
    const next = stepStringState(c, inString);
    if (next.skipNext) i++;
    inString = next.inString;
    if (next.wasInString || next.inString !== null) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface StringStateStep {
  readonly inString: string | null;
  readonly wasInString: boolean;
  readonly skipNext: boolean;
}

function stepStringState(c: string, inString: string | null): StringStateStep {
  if (inString === null) {
    if (c === '"' || c === "'" || c === "`") {
      return { inString: c, wasInString: false, skipNext: false };
    }
    return { inString: null, wasInString: false, skipNext: false };
  }
  if (c === "\\") return { inString, wasInString: true, skipNext: true };
  if (c === inString) return { inString: null, wasInString: true, skipNext: false };
  return { inString, wasInString: true, skipNext: false };
}

interface ForwardedNative {
  readonly tagName: string;
  readonly element: JsxElement;
  readonly kind: "expression" | "shorthand" | "spread";
}

function findForwardedNative(module: TsxModule, site: ComponentSite): ForwardedNative | null {
  for (const el of walkJsxElements(module)) {
    if (!inRange(el, site)) continue;
    if (!NATIVE_REQUIREABLE_TAGS.has(el.tagName.toLowerCase())) continue;
    const requiredAttr = getJsxAttribute(el, "required");
    if (requiredAttr?.value?.kind === "Expression") {
      return { tagName: el.tagName, element: el, kind: "expression" };
    }
    if (requiredAttr !== null && requiredAttr.value === null) {
      return { tagName: el.tagName, element: el, kind: "shorthand" };
    }
    if (requiredAttr === null && el.hasSpreadProps) {
      return { tagName: el.tagName, element: el, kind: "spread" };
    }
  }
  return null;
}

function inRange(el: JsxElement, site: ComponentSite): boolean {
  return el.range.start >= site.bodyStart && el.range.end <= site.bodyEnd;
}

function hasAriaRequired(module: TsxModule, site: ComponentSite): boolean {
  for (const el of walkJsxElements(module)) {
    if (!inRange(el, site)) continue;
    const attr = getJsxAttribute(el, "aria-required");
    if (attr === null) continue;
    return true;
  }
  return false;
}

function hasVisibleIndicator(source: string, module: TsxModule, site: ComponentSite): boolean {
  if (hasRequiredAbbrElement(module, site)) return true;
  const body = source.slice(site.bodyStart, site.bodyEnd);
  if (REQUIRED_TEXT_PATTERNS.some((p) => p.test(body))) return true;
  if (REQUIRED_GATE_PATTERNS.some((p) => p.test(body))) return true;
  return false;
}

function hasRequiredAbbrElement(module: TsxModule, site: ComponentSite): boolean {
  for (const el of walkJsxElements(module)) {
    if (!inRange(el, site)) continue;
    if (el.tagName.toLowerCase() !== "abbr") continue;
    const title = getJsxAttributeString(el, "title");
    if (title && /required/i.test(title)) return true;
  }
  return false;
}

const REQUIRED_TEXT_PATTERNS: readonly RegExp[] = [
  />\s*\*\s*</,
  /["'`]\s*\*\s*["'`]/,
  />\s*\(?\s*required\s*\)?\s*</i,
];

const REQUIRED_GATE_PATTERNS: readonly RegExp[] = [
  /\{\s*required\s*&&/,
  /\{\s*required\s*\?/,
  /\{\s*!\s*required\s*\?/,
];

function buildFinding(source: string, site: ComponentSite, forwarded: ForwardedNative): Finding {
  const pos = positionAt(source, site.nameOffset);
  const tag = forwarded.tagName.toLowerCase();
  const descriptor = describeForwarding(forwarded.kind);
  return {
    line: pos.line,
    column: pos.column,
    message: `<${site.name}> forwards \`required\` ${descriptor} <${tag}> but renders no visible required marker and no aria-required — users won't know the field is required until submission fails.`,
    suggestion: buildSuggestion(site.name, tag),
  };
}

function describeForwarding(kind: ForwardedNative["kind"]): string {
  if (kind === "expression") return "to a native";
  if (kind === "shorthand") return "(shorthand) on a native";
  return "via spread props to a native";
}

function buildSuggestion(componentName: string, tag: string): string {
  return `Add a visible indicator in <${componentName}>'s body (e.g. \`{required && <span aria-hidden="true">*</span>}\` next to the label) and set \`aria-required={required}\` on the <${tag}> so screen readers announce it. Either satisfies SC 3.3.2 alone; the pair satisfies both sighted and AT users.`;
}

interface Position {
  readonly line: number;
  readonly column: number;
}

function positionAt(source: string, offset: number): Position {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
