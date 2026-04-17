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
  const { source, line, reason } = input;
  if (!isCrossLineReason(reason)) {
    return buildFixedWindow(source, line, SNIPPET_NARROW_LINES, SNIPPET_NARROW_CHAR_CAP);
  }
  return buildFixedWindow(source, line, SNIPPET_WIDE_FALLBACK_LINES, SNIPPET_WIDE_CHAR_CAP);
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
