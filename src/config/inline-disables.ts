/**
 * Inline disable pragma parser.
 *
 * Users suppress individual violations via comments. Supported forms:
 *
 *   // ra11y-disable-next-line contrast/minimum
 *   <div className="muted">  // the next line's violation is skipped
 *
 *   // ra11y-disable contrast/minimum
 *   <div>...</div>
 *   // ra11y-enable contrast/minimum
 *     ^^^ violations between these are skipped
 *
 *   // ra11y-disable-next-line
 *   <div>...</div>
 *     ^^^ wildcard — all rules suppressed on that line
 *
 *   // ra11y-disable-next-line contrast/minimum: light text is only
 *   //   shown on a dark brand gradient that's enforced elsewhere
 *   <div className="muted">
 *     ^^^ reason text after `:` or `--` is captured for audit. Any
 *         rule IDs listed before the separator still apply. The
 *         reason is advisory — the suppression fires whether or
 *         not one is supplied — but surfacing it in scan meta keeps
 *         suppressions accountable.
 *
 * Comment styles supported: `//`, `/* … *\/`, `<!-- … -->` (HTML).
 * JSX `{/* … *\/}` is also recognized.
 *
 * JSDoc tag variant:
 *
 *   /** @ra11y-intentional demo of missing alt attribute *\/
 *   export function BadExample() {
 *     return <img src="..." />;
 *   }
 *
 * A JSDoc block (`/** … *\/`) attached to a function/class/variable
 * declaration that contains the tag `@ra11y-intentional <reason>` is
 * treated as a scoped `ra11y-disable *: <reason>` spanning the
 * decorated declaration's body (brace-balanced). This is the shape
 * Storybook-style "intentionally bad example" files use when the demo
 * MUST surface the violation to teach it. Bare `@ra11y-intentional`
 * (no reason text) is NOT honored — the reason slot is load-bearing
 * (AI-first doctrine, `docs/kb/architecture/ai-first-consumer.md`
 * "Ambiguous field shapes are dishonest") — but is recorded as a
 * declaration so the `suppression/no-reason` finder can surface a
 * review candidate pointing the agent at the missing reason.
 *
 * Tokens in the directive are stored opaquely — they can be rule IDs
 * (e.g. `keyboard/handler-missing`) to silence rule violations, or
 * criterion IDs (e.g. `wcag22:2.4.5`) to silence review candidates.
 * The rule-runner matches on rule IDs; the candidate-runner matches on
 * criterion IDs. A bare `ra11y-disable` with no token yields `"*"`,
 * which silences both.
 *
 * `parseInlineDisables(source)` returns the `(line → Set<token>)` map
 * the engine's context-builder consumes via `ctx.isDisabled(line,
 * ruleId)`. `parseInlineDisablesDetailed(source)` returns the same map
 * plus an ordered list of every declaration (line, ruleIds, optional
 * reason) so MCP surfaces can surface a durable audit trail without
 * re-parsing the source.
 */

const COMMENT_PATTERNS: readonly RegExp[] = [
  // Line comment: // ra11y-…
  /\/\/\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*(.*)$/,
  // Block comment: /* ra11y-… */
  /\/\*\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*([^*]*)\*\//,
  // HTML comment: <!-- ra11y-… -->
  /<!--\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*(.*?)-->/,
  // JSX block comment: {/* ra11y-… */}
  /\{\s*\/\*\s*(ra11y-(?:disable(?:-next-line)?|enable))\s*([^*]*)\*\/\s*\}/,
];

export type DisableMap = Map<number, Set<string>>;

/**
 * A suppression declaration captured from the source. Pragma comments
 * (`ra11y-disable`, `ra11y-disable-next-line`, `ra11y-enable`) and
 * JSDoc `@ra11y-intentional` tags both flow through this shape so
 * downstream consumers (audit trail, no-reason finder) can treat them
 * uniformly. The `tag` field distinguishes the two spellings when a
 * consumer needs to word a message differently.
 */
export interface SuppressionDeclaration {
  readonly kind: "disable" | "disable-next-line" | "enable";
  readonly line: number;
  readonly ruleIds: readonly string[];
  readonly reason?: string;
  /**
   * Source spelling of the declaration. `"ra11y-disable"` covers every
   * comment-pragma form (`//`, `/* *\/`, `<!-- -->`, `{/* *\/}`);
   * `"ra11y-intentional"` is the JSDoc tag variant used on a
   * function/class/variable declaration. Optional because older
   * consumers that only care about `kind` / `ruleIds` / `reason` stay
   * source-compatible — absent is the same as `"ra11y-disable"`.
   */
  readonly tag?: "ra11y-disable" | "ra11y-intentional";
}

/**
 * Scans `source` and builds a (line → set of disabled rule IDs) map.
 * Lines are 1-based.
 */
export function parseInlineDisables(source: string): DisableMap {
  return parseInlineDisablesDetailed(source).disableMap;
}

/**
 * Same as `parseInlineDisables` but also returns every pragma
 * declaration (including any captured reason text). Consumers that
 * want to surface the audit trail — e.g. `scan_project` meta — can
 * read `declarations` instead of re-parsing the source.
 */
export function parseInlineDisablesDetailed(source: string): {
  readonly disableMap: DisableMap;
  readonly declarations: readonly SuppressionDeclaration[];
} {
  const lines = source.split("\n");
  const disableMap: DisableMap = new Map();
  const declarations: SuppressionDeclaration[] = [];
  const regionStack: Array<{ ruleIds: readonly string[] }> = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNumber = idx + 1;
    const line = lines[idx] ?? "";
    applyRegionDisables(lineNumber, regionStack, disableMap);

    const pragma = findPragma(line);
    if (!pragma) continue;
    declarations.push({
      kind: pragma.kind,
      line: lineNumber,
      ruleIds: pragma.ruleIds,
      ...(pragma.reason === undefined ? {} : { reason: pragma.reason }),
      tag: "ra11y-disable",
    });
    handlePragma(pragma, lineNumber, regionStack, disableMap);
  }

  // JSDoc `@ra11y-intentional` tag — second pass so the source-level
  // pragmas above take effect first and the scoped-disable lines we
  // add here layer on top cleanly. Each tag with a reason becomes a
  // brace-balanced `*` disable over the decorated declaration's body.
  for (const intent of findIntentionalJsDocTags(source)) {
    declarations.push({
      kind: "disable",
      line: intent.tagLine,
      ruleIds: ["*"],
      ...(intent.reason === undefined ? {} : { reason: intent.reason }),
      tag: "ra11y-intentional",
    });
    // Bare `@ra11y-intentional` (no reason) is NOT honored — the reason
    // slot is load-bearing. The declaration above still records the
    // tag so the `suppression/no-reason` finder can surface a review
    // candidate; we just skip the disableMap update so violations on
    // the declared subtree still fire.
    if (intent.reason === undefined) continue;
    for (let ln = intent.scopeStartLine; ln <= intent.scopeEndLine; ln += 1) {
      addToLine(disableMap, ln, ["*"]);
    }
  }
  return { disableMap, declarations };
}

interface PragmaMatch {
  readonly kind: "disable" | "disable-next-line" | "enable";
  readonly ruleIds: readonly string[];
  readonly reason?: string;
}

function findPragma(line: string): PragmaMatch | null {
  for (const pattern of COMMENT_PATTERNS) {
    const m = pattern.exec(line);
    if (!m) continue;
    const directive = m[1];
    const tail = m[2] ?? "";
    if (!directive) return null;
    const { ruleIds, reason } = splitRuleListAndReason(tail);
    return {
      kind: pragmaKind(directive),
      ruleIds,
      ...(reason === undefined ? {} : { reason }),
    };
  }
  return null;
}

function pragmaKind(directive: string): PragmaMatch["kind"] {
  if (directive === "ra11y-disable-next-line") return "disable-next-line";
  if (directive === "ra11y-enable") return "enable";
  return "disable";
}

/**
 * Separates the rule-IDs portion of a pragma from the optional reason.
 * The first `:` that is not part of a criterion ID (`wcag22:2.4.5`) or
 * the first `--` sequence terminates the list; everything after is
 * captured as free-form reason text. Blank reasons are normalized to
 * undefined so the declaration stays shaped-terse.
 */
function splitRuleListAndReason(tail: string): {
  readonly ruleIds: readonly string[];
  readonly reason?: string;
} {
  const split = findReasonBoundary(tail);
  const head = split === null ? tail : tail.slice(0, split.index);
  const reasonRaw = split === null ? "" : tail.slice(split.index + split.len);
  const ruleIds = parseRuleList(head);
  const reason = normalizeReason(reasonRaw);
  return reason === undefined ? { ruleIds } : { ruleIds, reason };
}

function findReasonBoundary(tail: string): { index: number; len: number } | null {
  const dashes = tail.indexOf("--");
  let boundary: { index: number; len: number } | null =
    dashes >= 0 ? { index: dashes, len: 2 } : null;
  // Criterion IDs use `<standard>:<number>` — the char after the `:`
  // is always a digit (e.g. `wcag22:2.4.5`). A colon that is NOT
  // followed by a digit is therefore the reason separator. Rule IDs
  // use `/`, not `:`, so this rule is unambiguous.
  const colonPattern = /:(?!\d)/g;
  const colonMatch = colonPattern.exec(tail);
  if (colonMatch !== null && (boundary === null || colonMatch.index < boundary.index)) {
    boundary = { index: colonMatch.index, len: 1 };
  }
  return boundary;
}

function normalizeReason(raw: string): string | undefined {
  // Strip trailing `*/`, `-->`, or `}` tokens that belong to the
  // comment syntax, then collapse whitespace. Empty reasons become
  // undefined so downstream consumers can distinguish "no reason
  // supplied" from "empty reason string".
  const stripped = raw
    .replace(/\*\/\s*\}?\s*$/, "")
    .replace(/-->\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length === 0 ? undefined : stripped;
}

function parseRuleList(tail: string): readonly string[] {
  const tokens = tail
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith("*/") && !t.startsWith("-->"));
  return tokens.length === 0 ? ["*"] : tokens;
}

function handlePragma(
  pragma: PragmaMatch,
  lineNumber: number,
  regionStack: Array<{ ruleIds: readonly string[] }>,
  disableMap: DisableMap,
): void {
  if (pragma.kind === "disable-next-line") {
    addToLine(disableMap, lineNumber + 1, pragma.ruleIds);
    return;
  }
  if (pragma.kind === "disable") {
    regionStack.push({ ruleIds: pragma.ruleIds });
    return;
  }
  // "enable" — pop the most recent matching disable. If the enable
  // specifies rule IDs, we pop the most recent disable that started
  // with an intersecting rule set. For simplicity, we pop the top
  // region regardless of specificity — rules can choose to narrow
  // their own region with a new disable.
  regionStack.pop();
}

function addToLine(disableMap: DisableMap, line: number, ruleIds: readonly string[]): void {
  let set = disableMap.get(line);
  if (!set) {
    set = new Set();
    disableMap.set(line, set);
  }
  for (const ruleId of ruleIds) set.add(ruleId);
}

function applyRegionDisables(
  lineNumber: number,
  regionStack: ReadonlyArray<{ ruleIds: readonly string[] }>,
  disableMap: DisableMap,
): void {
  if (regionStack.length === 0) return;
  for (const region of regionStack) {
    addToLine(disableMap, lineNumber, region.ruleIds);
  }
}

// ---------------------------------------------------------------------------
// JSDoc `@ra11y-intentional` tag recognition
//
// Detection is purely syntactic: scan for `/** ... */` JSDoc blocks,
// extract any `@ra11y-intentional <reason>` tag text, and — when a
// declaration immediately follows the block — report the declaration's
// line span so the outer parser can scope-disable it. No semantic "is
// this a React component?" heuristics (per doctrine "No heuristic
// suppression"). Any declaration the author tagged is honored.
// ---------------------------------------------------------------------------

interface IntentionalJsDocTag {
  /** 1-based line where the JSDoc block opens (`/**`). */
  readonly tagLine: number;
  /** 1-based line of the first declaration line after the block. */
  readonly scopeStartLine: number;
  /** 1-based line where the declaration's body ends. */
  readonly scopeEndLine: number;
  /** Reason text captured from the tag, or undefined if bare. */
  readonly reason?: string;
}

/** Opening delimiter length for a JSDoc block (`/**`). */
const JSDOC_OPEN_LEN = 3;
/** Closing delimiter length for a JSDoc block (`*\/`). */
const JSDOC_CLOSE_LEN = 2;
/** Length of the tag spelling (`@ra11y-intentional`). */
const INTENTIONAL_TAG_LEN = "@ra11y-intentional".length;

function findIntentionalJsDocTags(source: string): readonly IntentionalJsDocTag[] {
  const out: IntentionalJsDocTag[] = [];
  let pos = 0;
  while (pos < source.length) {
    const blockStart = source.indexOf("/**", pos);
    if (blockStart < 0) break;
    const blockEnd = source.indexOf("*/", blockStart + JSDOC_OPEN_LEN);
    if (blockEnd < 0) break;
    const tag = tagFromJsDocBlock(source, blockStart, blockEnd);
    if (tag !== null) out.push(tag);
    pos = blockEnd + JSDOC_CLOSE_LEN;
  }
  return out;
}

/**
 * Returns a complete `IntentionalJsDocTag` for the JSDoc block
 * bracketed by (blockStart, blockEnd) — or null when the block has no
 * `@ra11y-intentional` tag, is an empty `/**\/` decorator, or is not
 * followed by a declaration.
 */
function tagFromJsDocBlock(
  source: string,
  blockStart: number,
  blockEnd: number,
): IntentionalJsDocTag | null {
  // A `/**/` zero-body block is not JSDoc — require at least one
  // character (including a `*`) between open and close.
  if (blockEnd <= blockStart + JSDOC_OPEN_LEN) return null;
  const body = source.slice(blockStart + JSDOC_OPEN_LEN, blockEnd);
  const intent = extractIntentional(body);
  if (intent === null) return null;
  const declStart = firstNonBlankLineAfter(source, blockEnd + JSDOC_CLOSE_LEN);
  if (declStart === null) return null;
  const endOffset = declarationEndOffset(source, declStart.offset);
  return {
    tagLine: lineOfOffset(source, blockStart),
    scopeStartLine: declStart.line,
    scopeEndLine: lineOfOffset(source, endOffset),
    ...(intent.reason === undefined ? {} : { reason: intent.reason }),
  };
}

/**
 * Extracts the `@ra11y-intentional` tag (if any) from a JSDoc block
 * body. Returns `{ reason }` when found — reason is undefined for a
 * bare tag, a cleaned string otherwise. Returns null when the tag is
 * absent. Continuation lines (subsequent `* <text>` lines before the
 * next `@tag` or the block close) are joined into the reason.
 */
function extractIntentional(body: string): { reason?: string } | null {
  const tagIdx = body.indexOf("@ra11y-intentional");
  if (tagIdx < 0) return null;
  // Guard against false-positives like `@ra11y-intentionally` — the
  // tag must end at a word boundary.
  const after = body.charAt(tagIdx + INTENTIONAL_TAG_LEN);
  if (after !== "" && /[A-Za-z0-9_-]/.test(after)) return null;
  // Collect reason text: everything from the tag to either the next
  // `@<word>` directive or the end of the block. Strip JSDoc
  // leading-asterisk decoration from continuation lines.
  const tail = body.slice(tagIdx + INTENTIONAL_TAG_LEN);
  const stop = /\n\s*\*?\s*@[A-Za-z]/.exec(tail);
  const raw = stop === null ? tail : tail.slice(0, stop.index);
  const cleaned = raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*+\s?/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
  if (cleaned.length === 0) return {};
  return { reason: cleaned };
}

/** 1-based line number for a byte offset. */
function lineOfOffset(source: string, offset: number): number {
  let line = 1;
  const limit = Math.min(offset, source.length);
  for (let i = 0; i < limit; i += 1) {
    if (source.charCodeAt(i) === /* \n */ 10) line += 1;
  }
  return line;
}

/**
 * Scans forward from `offset` for the first non-whitespace character
 * and returns its offset + 1-based line. Returns null if only
 * whitespace remains.
 */
function firstNonBlankLineAfter(
  source: string,
  offset: number,
): { readonly offset: number; readonly line: number } | null {
  let i = offset;
  while (i < source.length && /\s/.test(source.charAt(i))) i += 1;
  if (i >= source.length) return null;
  return { offset: i, line: lineOfOffset(source, i) };
}

/**
 * Returns the byte offset of the last character belonging to the
 * declaration that starts at `declStart`. The scan tracks balanced
 * parens/brackets/braces and skips string/template literals and
 * comments, so JSX braces and nested call expressions don't confuse
 * the boundary. Three termination modes:
 *
 *   - brace-bodied declaration (`function X() { … }` /
 *     `const X = () => { … }` / `class X { … }`): end at the matching
 *     `}` closing the declaration body.
 *   - expression-bodied arrow / assignment
 *     (`const X = () => <div/>;` / `const X = <div/>`): end at the
 *     terminating `;` or the first newline that closes the expression
 *     when depth is back to zero.
 *   - EOF fallback: end at the last character of the source.
 */
function declarationEndOffset(source: string, declStart: number): number {
  const state: ScanState = { depth: 0, sawOpenBrace: false };
  let i = declStart;
  while (i < source.length) {
    const skip = skipLiteralOrComment(source, i);
    if (skip > i) {
      i = skip;
      continue;
    }
    const ch = source.charAt(i);
    const step = stepScan(source, i, ch, state, declStart);
    if (step.terminated) return i;
    i = step.next;
  }
  return source.length - 1;
}

interface ScanState {
  depth: number;
  sawOpenBrace: boolean;
}

/**
 * One step of `declarationEndOffset`'s main loop. Returns whether the
 * step terminated the scan (the outer function should return `i`) and
 * the next offset to continue from. Extracted so the cyclomatic
 * complexity of the top-level loop stays under budget.
 */
function stepScan(
  source: string,
  i: number,
  ch: string,
  state: ScanState,
  declStart: number,
): { readonly terminated: boolean; readonly next: number } {
  if (ch === "{" || ch === "(" || ch === "[") {
    if (ch === "{") state.sawOpenBrace = true;
    state.depth += 1;
    return { terminated: false, next: i + 1 };
  }
  if (ch === "}" || ch === ")" || ch === "]") {
    state.depth -= 1;
    if (state.depth === 0 && state.sawOpenBrace) return { terminated: true, next: i };
    if (state.depth < 0) return { terminated: true, next: i };
    return { terminated: false, next: i + 1 };
  }
  if (state.depth === 0 && isExpressionTerminator(source, i, ch, declStart)) {
    return { terminated: true, next: i };
  }
  return { terminated: false, next: i + 1 };
}

/**
 * True when a `;` or `\n` at depth zero closes an expression-bodied
 * declaration (`const X = () => <div/>;` / `const X = <div/>`). A
 * `;` always terminates once past the declaration keyword; a `\n`
 * terminates only when the next non-whitespace character looks like a
 * new top-level construct — so multi-line initialisers without a
 * terminator keep scanning.
 */
function isExpressionTerminator(source: string, i: number, ch: string, declStart: number): boolean {
  if (ch !== ";" && ch !== "\n") return false;
  if (!sawNonWhitespaceSinceStart(source, declStart, i)) return false;
  if (ch === ";") return true;
  const next = peekNextNonBlank(source, i + 1);
  if (next === null) return true;
  if (!/[A-Za-z_$/]/.test(next)) return false;
  return looksLikeNewDeclaration(source, i + 1);
}

/**
 * If `source[i]` begins a string, template literal, regex, or comment,
 * returns the offset just past its end. Otherwise returns `i` (no
 * skip). Single char lookahead keeps this cheap per iteration.
 */
function skipLiteralOrComment(source: string, i: number): number {
  const ch = source.charAt(i);
  if (ch === "/" && source.charAt(i + 1) === "/") {
    const nl = source.indexOf("\n", i + 2);
    return nl < 0 ? source.length : nl;
  }
  if (ch === "/" && source.charAt(i + 1) === "*") {
    const end = source.indexOf("*/", i + 2);
    return end < 0 ? source.length : end + JSDOC_CLOSE_LEN;
  }
  if (ch === '"' || ch === "'") return skipQuoted(source, i, ch);
  if (ch === "`") return skipTemplate(source, i);
  return i;
}

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\n") return i; // unterminated — bail at newline
    i += 1;
  }
  return source.length;
}

function skipTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && source.charAt(i + 1) === "{") {
      i = skipTemplateInterpolation(source, i + 2);
      continue;
    }
    i += 1;
  }
  return source.length;
}

/**
 * Scans forward from just after a `${` in a template literal,
 * consuming balanced braces (respecting nested strings, comments,
 * and nested template literals) until the matching `}` is found.
 * Returns the offset just past that `}`. Extracted so `skipTemplate`
 * stays under the cognitive-complexity budget.
 */
function skipTemplateInterpolation(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const inner = source.charAt(i);
    const skip = skipLiteralOrComment(source, i);
    if (skip > i) {
      i = skip;
      continue;
    }
    if (inner === "{") depth += 1;
    else if (inner === "}") depth -= 1;
    i += 1;
  }
  return i;
}

function sawNonWhitespaceSinceStart(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) {
    if (!/\s/.test(source.charAt(i))) return true;
  }
  return false;
}

function peekNextNonBlank(source: string, from: number): string | null {
  let i = from;
  while (i < source.length && /\s/.test(source.charAt(i))) i += 1;
  return i < source.length ? source.charAt(i) : null;
}

/**
 * True when the text starting at `offset` looks like a new top-level
 * declaration or JSDoc block — i.e. the previous declaration's body
 * has ended. Covers `export`, `function`, `class`, `const`, `let`,
 * `var`, `async`, `type`, `interface`, and a leading `/*` comment.
 */
function looksLikeNewDeclaration(source: string, offset: number): boolean {
  const tail = source.slice(offset).replace(/^\s+/, "");
  return /^(export\b|function\b|class\b|const\b|let\b|var\b|async\b|type\b|interface\b|\/\*)/.test(
    tail,
  );
}
