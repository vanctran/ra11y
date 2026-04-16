/**
 * Distinguishes TypeScript generic type arguments (`Pick<Crypto, 'x'>`,
 * `Array<string>`, `<T extends U>(x: T)`) from JSX element openings.
 *
 * This is a structural heuristic, not a full TypeScript parser. The
 * in-house TSX parser (`tsx.ts`) doesn't have semantic context, so
 * without this pass it treats every `<PascalCase…>` in a type position
 * as an unclosed JSX element and emits spurious parse errors on ~40%
 * of modern TS/TSX files (fields like `Pick<T, K>` or
 * `ForwardRefRenderFunction<HTMLButtonElement, Props>` are the common
 * offenders).
 *
 * The classifier runs at the top-level scan, before the element
 * consumer commits. When it says "generic", the scanner skips past the
 * balanced closing `>` and keeps looking for real JSX. When it says
 * "JSX" (or returns `null` because the window ran out), we fall
 * through to the legacy JSX path — never silently drop a long JSX
 * element that nests more deeply than we scanned.
 */

/**
 * How far the classifier scans before bailing out. Real JSX open tags
 * and type argument lists are short; long runs of unbalanced brackets
 * usually mean we're in pathological source where "fall through to
 * JSX" is safer than guessing "generic" and skipping real content.
 */
const CLASSIFY_WINDOW = 4096;

/**
 * TS type operators that only appear inside `<>` at type positions.
 * None of them can legally appear at depth 1 of a JSX element's open
 * tag.
 */
const TS_TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  "extends",
  "keyof",
  "typeof",
  "infer",
  "readonly",
  "unique",
  "is",
  "asserts",
  "new",
]);

/**
 * Characters that, when they immediately follow the closing `>` of an
 * otherwise ambiguous `<Ident>` (no inner generic signals), tip the
 * verdict toward "single-arg generic type argument used in an
 * expression" (`foo<T>(arg)`, `x as Foo<T>;`). None of these naturally
 * start JSX children.
 */
const POST_GT_GENERIC_CHARS: ReadonlySet<string> = new Set([
  "(",
  "=",
  ";",
  ",",
  ")",
  ".",
  "&",
  "|",
  ":",
  "[",
  "!",
  "?",
]);

/**
 * Keywords that legitimately put a following `<Ident` in JSX-expression
 * position rather than generic-instantiation position (`return <div>`,
 * `yield <Foo/>`, `throw <Error/>`). Identifiers NOT in this set,
 * followed directly by `<`, are generic calls (`Array<Foo>`,
 * `map<Foo>`), never JSX.
 */
const JSX_EXPRESSION_PRECEDING_KEYWORDS: ReadonlySet<string> = new Set([
  "return",
  "throw",
  "yield",
  "await",
  "case",
  "typeof",
  "void",
  "delete",
  "in",
  "of",
  "new",
  "extends",
  "implements",
  "satisfies",
  "as",
  "instanceof",
]);

type ScanResult =
  | { readonly kind: "generic"; readonly endPos: number }
  | { readonly kind: "jsx"; readonly endPos: number }
  | { readonly kind: "ambiguous"; readonly endPos: number };

export function classifyAngleBracket(
  src: string,
  start: number,
): { isGeneric: boolean; endPos: number } | null {
  const firstCh = src[start + 1];
  if (firstCh === undefined) return null;
  const tagIsLowercase = firstCh === firstCh.toLowerCase();
  const seededGeneric = precedingIsGenericCall(src, start);
  const scan = scanGenericBody(src, start, seededGeneric);
  if (scan === null) return null;
  if (scan.kind === "generic") return { isGeneric: true, endPos: scan.endPos };
  if (scan.kind === "jsx") return { isGeneric: false, endPos: scan.endPos };
  if (tagIsLowercase) return { isGeneric: false, endPos: scan.endPos };
  return {
    isGeneric: postGtImpliesGeneric(src, scan.endPos),
    endPos: scan.endPos,
  };
}

function scanGenericBody(src: string, start: number, seed: boolean): ScanResult | null {
  const limit = Math.min(src.length, start + CLASSIFY_WINDOW);
  let p = start + 1;
  let depth = 1;
  let sawGeneric = seed;
  while (p < limit && depth > 0) {
    const step = stepScan(src, p, depth);
    if (step === null) return null;
    if (step.jsxHard) return { kind: "jsx", endPos: p + 1 };
    p = step.p;
    depth = step.depth;
    if (step.generic) sawGeneric = true;
  }
  if (depth !== 0) return null;
  return sawGeneric ? { kind: "generic", endPos: p } : { kind: "ambiguous", endPos: p };
}

interface StepOutcome {
  readonly p: number;
  readonly depth: number;
  readonly generic?: boolean;
  readonly jsxHard?: boolean;
}

function stepScan(src: string, p: number, depth: number): StepOutcome | null {
  const c = src[p];
  if (c === undefined) return null;
  if (c === '"' || c === "'") return { p: skipStringLiteral(src, p, c), depth };
  if (c === "`") return { p: skipTemplateLiteral(src, p), depth };
  if (c === "{") return { p: skipBalanced(src, p, "{", "}"), depth };
  if (c === "<") return { p: p + 1, depth: depth + 1, generic: true };
  if (c === ">") return { p: p + 1, depth: depth - 1 };
  if (depth === 1) return stepDepthOne(src, p, c);
  return { p: p + 1, depth };
}

function stepDepthOne(src: string, p: number, c: string): StepOutcome {
  if (c === "/") return { p: p + 1, depth: 1, jsxHard: true };
  if (isGenericStructuralChar(c)) return { p: p + 1, depth: 1, generic: true };
  if (isIdentStart(c)) {
    const end = readIdentEnd(src, p);
    if (TS_TYPE_KEYWORDS.has(src.slice(p, end))) {
      return { p: end, depth: 1, generic: true };
    }
    return { p: end, depth: 1 };
  }
  return { p: p + 1, depth: 1 };
}

function postGtImpliesGeneric(src: string, endPos: number): boolean {
  let q = endPos;
  while (q < src.length) {
    const ch = src[q];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") q += 1;
    else break;
  }
  const next = src[q];
  return next !== undefined && POST_GT_GENERIC_CHARS.has(next);
}

/**
 * Does the character sequence immediately before `pos` indicate that
 * `<Ident` at `pos` is a TypeScript generic call (`Array<T>`,
 * `arr.map<U>()`, `(fn)<T>()`) rather than the start of a JSX element?
 * Pure lookback: skip whitespace, classify the preceding char/word.
 * Returns `false` when in doubt so the content-based heuristic runs.
 */
function precedingIsGenericCall(src: string, pos: number): boolean {
  let p = pos - 1;
  while (p >= 0) {
    const ch = src[p];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      p -= 1;
      continue;
    }
    break;
  }
  if (p < 0) return false;
  const ch = src[p];
  if (ch === undefined) return false;
  if (ch === ")" || ch === "]" || ch === ".") return true;
  if (!/[a-zA-Z0-9_$]/.test(ch)) return false;
  let wordStart = p;
  while (wordStart >= 0) {
    const wc = src[wordStart];
    if (wc === undefined || !/[a-zA-Z0-9_$]/.test(wc)) break;
    wordStart -= 1;
  }
  const word = src.slice(wordStart + 1, p + 1);
  return !JSX_EXPRESSION_PRECEDING_KEYWORDS.has(word);
}

function isGenericStructuralChar(c: string): boolean {
  return c === "," || c === "|" || c === "&" || c === "?" || c === "(" || c === "[";
}

function isIdentStart(c: string): boolean {
  return /[a-zA-Z_$]/.test(c);
}

function readIdentEnd(src: string, start: number): number {
  let p = start;
  while (p < src.length) {
    const ch = src[p];
    if (ch === undefined || !/[a-zA-Z0-9_$]/.test(ch)) break;
    p += 1;
  }
  return p;
}

function skipStringLiteral(src: string, start: number, quote: string): number {
  let p = start + 1;
  while (p < src.length && src[p] !== quote) {
    p += src[p] === "\\" ? 2 : 1;
  }
  return p < src.length ? p + 1 : p;
}

function skipTemplateLiteral(src: string, start: number): number {
  let p = start + 1;
  while (p < src.length && src[p] !== "`") {
    p += src[p] === "\\" ? 2 : 1;
  }
  return p < src.length ? p + 1 : p;
}

function skipBalanced(src: string, start: number, open: string, close: string): number {
  let depth = 1;
  let p = start + 1;
  while (p < src.length && depth > 0) {
    const ch = src[p];
    if (ch === '"' || ch === "'") {
      p = skipStringLiteral(src, p, ch);
      continue;
    }
    if (ch === "`") {
      p = skipTemplateLiteral(src, p);
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) depth -= 1;
    p += 1;
  }
  return p;
}
