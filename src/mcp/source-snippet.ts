/**
 * Builds short source snippets for MCP tool responses so agents can
 * skip a full-file `Read` round-trip when they already have the line
 * number from a candidate or finding. The scanner has the source text
 * in memory (every `ParsedFile.source`); this module reads from that
 * cache rather than re-opening files.
 *
 * Two widths, one shape. Most findings get a narrow ±3-line window,
 * which is enough when the evidence is attribute-level ("img missing
 * alt"). Some findings' `reason` text explicitly cites cross-line
 * context ("handler defined outside this line") — for those, the
 * snippet widens to a fixed ±10-line window as an honest fallback.
 * A follow-up commit replaces the fallback with an AST-enclosing-block
 * walk for TSX/JSX/TS/JS, where the enclosing function is a more
 * useful unit of review context than a fixed line count.
 *
 * Shape invariant: if the snippet can't be produced honestly (file
 * missing from cache, line out of range, no file:line on the input),
 * the caller omits the field entirely. Per CLAUDE.md §1 "Ambiguous
 * field shapes are dishonest" — an empty string is indistinguishable
 * from "we looked and it was blank," which silently breaks the agent's
 * next-step inference.
 */

import type { ParsedFile } from "../engine/scanner.ts";
import type { Ast } from "../types/ast.ts";

/** Language tag for the snippet builder — matches {@link Ast}'s discriminant. */
export type SnippetLanguage = Ast["language"];

/** Lines of context on each side of the target line, narrow mode. */
const SNIPPET_NARROW_LINES = 3;
/** Lines of context on each side of the target line, wide fallback mode. */
const SNIPPET_WIDE_FALLBACK_LINES = 10;
/**
 * Char cap for narrow mode. 300 is big enough to cover a JSX element
 * with an attribute cluster across ±3 lines after de-indent, but small
 * enough that 30 candidates in one response stay well under the stdio
 * frame budget.
 */
const SNIPPET_NARROW_CHAR_CAP = 300;
/**
 * Char cap for wide mode. 600 is big enough for a typical handler
 * body (≈20-30 lines at normal indent) after de-indent — the thing a
 * cross-line-reason finding actually needs the agent to read — while
 * staying well under the stdio frame budget even at 10 wide snippets
 * per response.
 */
const SNIPPET_WIDE_CHAR_CAP = 600;

/**
 * Reason-text patterns that indicate the finding's evidence spans
 * multiple lines, so the snippet should widen past the narrow ±3-line
 * default. Deliberately small and grep-able — new finders that emit
 * cross-line reasons extend this list by adding a phrase to the
 * reason, not by plumbing a per-finder config flag through the
 * response pipeline.
 */
export const CROSS_LINE_REASON_PATTERNS: readonly RegExp[] = [
  /defined outside this line/i,
  /handler defined elsewhere/i,
  /referenced function/i,
  /named handler defined/i,
  /defined at line/i,
  /body spans multiple/i,
  /handler body/i,
  /cross-line/i,
];

/** A ParsedFile view keyed by file path for O(1) lookup in the response builder. */
export interface SourceEntry {
  readonly source: string;
  readonly language: SnippetLanguage;
}

/**
 * Indexes parsed files by their `filePath`. The scanner holds a single
 * source-of-truth list per scan; this is a per-response view over it.
 * Do not cache across responses — ParsedFile instances are replaced on
 * file mtime changes. Carries `language` alongside `source` so callers
 * picking a snippet width don't have to parse file extensions.
 *
 * @param files - Parsed files from the current scan.
 * @returns A path-to-entry map with language tags preserved.
 */
export function sourceIndex(files: readonly ParsedFile[]): Map<string, SourceEntry> {
  const out = new Map<string, SourceEntry>();
  for (const f of files) out.set(f.filePath, { source: f.source, language: f.ast.language });
  return out;
}

/**
 * Narrow snippet: ±{@link SNIPPET_NARROW_LINES} lines around `line`
 * (1-indexed), common leading whitespace stripped, capped at
 * {@link SNIPPET_NARROW_CHAR_CAP} characters. Returns `undefined` when
 * the input is unusable (empty source, line out of bounds, non-integer
 * line) so the caller conditional-spreads the field away.
 *
 * @param source - Full file source as held in `ParsedFile.source`.
 * @param line - 1-based line number of the finding's anchor.
 * @returns A de-indented ±3-line string, or `undefined` when unusable.
 */
export function buildSnippet(source: string, line: number): string | undefined {
  return buildFixedWindow(source, line, SNIPPET_NARROW_LINES, SNIPPET_NARROW_CHAR_CAP);
}

/** Input to {@link buildSnippetForReason}. */
export interface SnippetForReasonInput {
  readonly source: string;
  readonly line: number;
  readonly reason: string;
  readonly language: SnippetLanguage;
}

/**
 * Picks a snippet width based on the finding's own `reason` text.
 * Narrow ±3-line default when the reason does not cite cross-line
 * context; ±{@link SNIPPET_WIDE_FALLBACK_LINES} lines otherwise.
 *
 * A follow-up commit upgrades the TSX/JSX/TS/JS wide path to walk the
 * enclosing JS block via brace balance — this step ships the trigger
 * and the fallback so finders can start emitting cross-line reasons.
 *
 * @param input - Source, target line, reason text, and language tag.
 * @returns A de-indented snippet sized to the reason, or `undefined`.
 */
export function buildSnippetForReason(input: SnippetForReasonInput): string | undefined {
  const { source, line, reason, language } = input;
  if (!isCrossLineReason(reason)) {
    return buildFixedWindow(source, line, SNIPPET_NARROW_LINES, SNIPPET_NARROW_CHAR_CAP);
  }
  if (isBraceBalancedLanguage(language)) {
    const block = findEnclosingBlock(source, line);
    if (block) {
      const snippet = renderLineRange(
        source,
        block.startLine,
        block.endLine,
        SNIPPET_WIDE_CHAR_CAP,
      );
      if (snippet !== undefined) return snippet;
      // Enclosing block exceeds the char cap — fall through to the line-based
      // fallback rather than truncate mid-expression (truncated is ambiguous).
    }
  }
  return buildFixedWindow(source, line, SNIPPET_WIDE_FALLBACK_LINES, SNIPPET_WIDE_CHAR_CAP);
}

/** Languages for which brace-balance block detection is meaningful. */
function isBraceBalancedLanguage(language: SnippetLanguage): boolean {
  return language === "tsx" || language === "jsx" || language === "ts" || language === "js";
}

/**
 * Brace-balance walker for TSX/JSX/TS/JS. Given `source` and a 1-based
 * `line`, finds the nearest enclosing `{...}` block whose body contains
 * `line`. Returns a `{startLine, endLine}` pair (1-based, inclusive) on
 * the lines carrying the opening `{` and closing `}`, or `undefined`
 * when no enclosing block exists (e.g. top-level statement with no
 * wrapping function / class / block).
 *
 * The walker is string- and comment-aware: braces inside string
 * literals (`"..."`, `'...'`, `` `...` ``), line comments (`// ...`),
 * and block comments (`/* ... *\/`) do not count. Template-literal
 * expressions (`${ ... }`) do count — standard JS behavior, a template
 * expression's own braces balance normally.
 *
 * Regex-free character walk. No AST / parser dependency.
 *
 * @param source - Full TSX/JSX/TS/JS source text.
 * @param line - 1-based line number inside the body whose enclosing
 *   block we want.
 * @returns The enclosing block's opening / closing line pair, or
 *   `undefined` when no enclosing block exists.
 */
export function findEnclosingBlock(
  source: string,
  line: number,
): { startLine: number; endLine: number } | undefined {
  if (typeof source !== "string" || source.length === 0) return undefined;
  if (!Number.isInteger(line) || line < 1) return undefined;

  const { tokens, lineStarts } = tokenizeBraces(source);
  if (line > lineStarts.length) return undefined;

  // Byte offset of the anchor line's start — any `{` at or before this
  // offset with a matching `}` at or after this offset encloses us.
  const anchorOffset = lineStarts[line - 1] ?? 0;
  const openOffset = findInnermostOpenAt(tokens, anchorOffset);
  if (openOffset === undefined) return undefined;
  const closeOffset = findMatchingClose(tokens, openOffset);
  if (closeOffset === undefined) return undefined;

  return {
    startLine: offsetToLine(openOffset, lineStarts),
    endLine: offsetToLine(closeOffset, lineStarts),
  };
}

/**
 * Walks `tokens` up to `anchorOffset` maintaining a stack of open
 * brace offsets; returns the top of the stack at the anchor — i.e. the
 * innermost unmatched `{` at that point. Returns `undefined` when the
 * anchor is not inside any block.
 */
function findInnermostOpenAt(
  tokens: readonly BraceToken[],
  anchorOffset: number,
): number | undefined {
  const stack: number[] = [];
  for (const t of tokens) {
    if (t.offset > anchorOffset) break;
    if (t.kind === "{") stack.push(t.offset);
    else if (stack.length > 0) stack.pop();
  }
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

/**
 * Walks `tokens` from `openOffset` onward matching brace depth;
 * returns the offset of the `}` that closes `openOffset`, or
 * `undefined` if the stream is unbalanced.
 */
function findMatchingClose(tokens: readonly BraceToken[], openOffset: number): number | undefined {
  let depth = 0;
  for (const t of tokens) {
    if (t.offset < openOffset) continue;
    depth += t.kind === "{" ? 1 : -1;
    if (depth === 0) return t.offset;
  }
  return undefined;
}

interface BraceToken {
  readonly kind: "{" | "}";
  readonly offset: number;
}

type ScanState =
  | { kind: "code" }
  | { kind: "line-comment" }
  | { kind: "block-comment" }
  | { kind: "string"; quote: '"' | "'" }
  | { kind: "template" };

/** Mutable scratch for the tokenizer's state machine. */
interface Scanner {
  readonly source: string;
  i: number;
  readonly states: ScanState[];
  /** Brace depth inside each active `${...}` expression (parallel to states). */
  readonly exprDepth: number[];
  readonly tokens: BraceToken[];
  readonly lineStarts: number[];
}

/**
 * Scans `source` once, emitting every `{` and `}` that sits in code
 * context — skipping those inside string literals, template literal
 * text, line comments, and block comments. Template-literal
 * expressions (`${...}`) are treated as regular code so their braces
 * balance normally. Also builds a `lineStarts` table (byte offset of
 * the start of each 1-based line) so callers can map offsets to lines
 * without re-splitting the source.
 */
function tokenizeBraces(source: string): {
  tokens: BraceToken[];
  lineStarts: number[];
} {
  const s: Scanner = {
    source,
    i: 0,
    states: [{ kind: "code" }],
    exprDepth: [],
    tokens: [],
    lineStarts: [0],
  };
  const len = source.length;
  while (s.i < len) {
    const ch = source[s.i] ?? "";
    if (ch === "\n") s.lineStarts.push(s.i + 1);
    stepScanner(s, ch);
  }
  return { tokens: s.tokens, lineStarts: s.lineStarts };
}

/** Dispatch one character to the active state's handler. */
function stepScanner(s: Scanner, ch: string): void {
  const top = s.states[s.states.length - 1] ?? { kind: "code" };
  switch (top.kind) {
    case "line-comment":
      stepLineComment(s, ch);
      return;
    case "block-comment":
      stepBlockComment(s, ch);
      return;
    case "string":
      stepString(s, ch, top.quote);
      return;
    case "template":
      stepTemplate(s, ch);
      return;
    default:
      stepCode(s, ch);
  }
}

function stepLineComment(s: Scanner, ch: string): void {
  if (ch === "\n") s.states.pop();
  s.i += 1;
}

function stepBlockComment(s: Scanner, ch: string): void {
  if (ch === "*" && s.source[s.i + 1] === "/") {
    s.states.pop();
    s.i += 2;
    return;
  }
  s.i += 1;
}

function stepString(s: Scanner, ch: string, quote: '"' | "'"): void {
  if (ch === "\\") {
    s.i += 2; // skip escape
    return;
  }
  if (ch === quote || ch === "\n") {
    // JS string literals can't span raw newlines; recover on EOL so a
    // stray quote doesn't swallow the rest of the file.
    s.states.pop();
    s.i += 1;
    return;
  }
  s.i += 1;
}

function stepTemplate(s: Scanner, ch: string): void {
  if (ch === "\\") {
    s.i += 2;
    return;
  }
  if (ch === "`") {
    s.states.pop();
    s.i += 1;
    return;
  }
  if (ch === "$" && s.source[s.i + 1] === "{") {
    s.states.push({ kind: "code" });
    s.exprDepth.push(0);
    s.i += 2;
    return;
  }
  s.i += 1;
}

function stepCode(s: Scanner, ch: string): void {
  const next = s.source[s.i + 1];
  if (ch === "/" && (next === "/" || next === "*")) {
    s.states.push({ kind: next === "/" ? "line-comment" : "block-comment" });
    s.i += 2;
    return;
  }
  if (ch === '"' || ch === "'") {
    s.states.push({ kind: "string", quote: ch });
    s.i += 1;
    return;
  }
  if (ch === "`") {
    s.states.push({ kind: "template" });
    s.i += 1;
    return;
  }
  if (ch === "{") {
    emitOpenBrace(s);
    return;
  }
  if (ch === "}") {
    emitCloseBrace(s);
    return;
  }
  s.i += 1;
}

function emitOpenBrace(s: Scanner): void {
  if (s.exprDepth.length > 0) {
    s.exprDepth[s.exprDepth.length - 1] = (s.exprDepth[s.exprDepth.length - 1] ?? 0) + 1;
  }
  s.tokens.push({ kind: "{", offset: s.i });
  s.i += 1;
}

function emitCloseBrace(s: Scanner): void {
  if (s.exprDepth.length > 0) {
    const d = (s.exprDepth[s.exprDepth.length - 1] ?? 0) - 1;
    if (d < 0) {
      // Closing brace of a `${...}` — return to template string state.
      s.exprDepth.pop();
      s.states.pop();
      s.i += 1;
      return;
    }
    s.exprDepth[s.exprDepth.length - 1] = d;
  }
  s.tokens.push({ kind: "}", offset: s.i });
  s.i += 1;
}

/** 1-based line number containing `offset`. */
function offsetToLine(offset: number, lineStarts: readonly number[]): number {
  // Binary search over lineStarts; returns the largest i with
  // lineStarts[i] ≤ offset, plus 1 for 1-based indexing.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const v = lineStarts[mid] ?? 0;
    if (v <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Renders `source` lines `[startLine, endLine]` (1-based, inclusive)
 * with common-indent stripping, returning `undefined` when the result
 * would exceed `cap`. Caller falls back to a fixed-line window when
 * `undefined` is returned, rather than truncating mid-expression — a
 * truncated snippet is ambiguous (see CLAUDE.md §1).
 */
function renderLineRange(
  source: string,
  startLine: number,
  endLine: number,
  cap: number,
): string | undefined {
  const lines = source.split("\n");
  if (startLine < 1 || endLine > lines.length || startLine > endLine) return undefined;
  const window = lines.slice(startLine - 1, endLine);
  if (window.length === 0) return undefined;
  const deindented = stripCommonIndent(window);
  const joined = deindented.join("\n");
  if (joined.length === 0) return undefined;
  if (joined.length > cap) return undefined;
  return joined;
}

/**
 * True when `reason` matches any entry in
 * {@link CROSS_LINE_REASON_PATTERNS}. Exported for unit testing and
 * so callers can branch on the same signal if they ever need to.
 *
 * @param reason - Candidate or violation reason text.
 * @returns `true` when the reason cites cross-line evidence.
 */
export function isCrossLineReason(reason: string): boolean {
  if (typeof reason !== "string" || reason.length === 0) return false;
  for (const re of CROSS_LINE_REASON_PATTERNS) {
    if (re.test(reason)) return true;
  }
  return false;
}

function buildFixedWindow(
  source: string,
  line: number,
  radius: number,
  cap: number,
): string | undefined {
  if (typeof source !== "string" || source.length === 0) return undefined;
  if (!Number.isInteger(line) || line < 1) return undefined;

  const lines = source.split("\n");
  if (line > lines.length) return undefined;

  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line + radius);
  const window = lines.slice(start, end);
  if (window.length === 0) return undefined;

  const deindented = stripCommonIndent(window);
  const joined = deindented.join("\n");
  if (joined.length <= cap) return joined.length > 0 ? joined : undefined;

  const anchor = Math.min(line - 1 - start, deindented.length - 1);
  const shrunk = shrinkAroundAnchor(deindented, anchor, cap);
  return shrunk.length > 0 ? shrunk : undefined;
}

/**
 * Strips the longest leading-whitespace prefix common to every
 * non-blank line in `window`. Blank lines contribute no indent floor
 * (a lone blank must not collapse the strip to zero). Mixed tab /
 * space lines are handled character-wise: the strip only removes as
 * much as literally matches on every line.
 */
function stripCommonIndent(window: readonly string[]): string[] {
  let common: string | undefined;
  for (const raw of window) {
    if (raw.trim().length === 0) continue;
    const indent = leadingWhitespace(raw);
    if (common === undefined) {
      common = indent;
      continue;
    }
    common = sharedPrefix(common, indent);
    if (common.length === 0) break;
  }
  if (!common || common.length === 0) return [...window];
  const prefix = common;
  return window.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l));
}

function leadingWhitespace(s: string): string {
  let i = 0;
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i += 1;
  return s.slice(0, i);
}

function sharedPrefix(a: string, b: string): string {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return a.slice(0, i);
}

/**
 * Shrinks a line array around `anchor` (0-indexed) to fit under `cap`
 * characters including join newlines. Keeps the anchor first, then
 * extends forward one line at a time, then backward. Returns a string
 * (possibly shorter than the anchor line if the anchor alone exceeds
 * the cap — in that case we truncate and append an ellipsis marker so
 * the agent knows it was cut).
 */
function shrinkAroundAnchor(lines: readonly string[], anchor: number, cap: number): string {
  const anchorLine = lines[anchor] ?? "";
  if (anchorLine.length > cap) {
    const marker = "…";
    return `${anchorLine.slice(0, Math.max(0, cap - marker.length))}${marker}`;
  }

  let out = anchorLine;
  let forward = anchor + 1;
  let backward = anchor - 1;

  while (forward < lines.length) {
    const next = lines[forward] ?? "";
    const projected = out.length + 1 + next.length;
    if (projected > cap) break;
    out = `${out}\n${next}`;
    forward += 1;
  }
  while (backward >= 0) {
    const prev = lines[backward] ?? "";
    const projected = prev.length + 1 + out.length;
    if (projected > cap) break;
    out = `${prev}\n${out}`;
    backward -= 1;
  }
  return out;
}
