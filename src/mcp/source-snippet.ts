/**
 * Builds short source snippets for MCP tool responses so agents can
 * skip a full-file `Read` round-trip when they already have the line
 * number from a candidate or finding. The scanner has the source text
 * in memory (every `ParsedFile.source`); this module reads from that
 * cache rather than re-opening files.
 *
 * Shape invariant: if the snippet can't be produced honestly (file
 * missing from cache, line out of range, no file:line on the input),
 * the caller omits the field entirely. Per CLAUDE.md §1 "Ambiguous
 * field shapes are dishonest" — an empty string is indistinguishable
 * from "we looked and it was blank," which silently breaks the agent's
 * next-step inference.
 */

import type { ParsedFile } from "../engine/scanner.ts";

/** Lines of context to include on each side of the target line. */
const CONTEXT_LINES = 3;
/**
 * Maximum total characters returned (including newlines). 300 is big
 * enough to cover a JSX element with attribute cluster across ±3 lines
 * after de-indent, but small enough that 30 candidates in one response
 * stay well under the stdio frame budget.
 */
const MAX_SNIPPET_CHARS = 300;

/**
 * Indexes parsed files by their `filePath` for O(1) lookup in the
 * response builder. The scanner holds a single source-of-truth list
 * per scan; this is a per-response view over it. Do not cache across
 * responses — ParsedFile instances are replaced on file mtime changes.
 */
export function sourceIndex(files: readonly ParsedFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) out.set(f.filePath, f.source);
  return out;
}

/**
 * Returns ±{@link CONTEXT_LINES} lines around `line` (1-indexed) from
 * `source`, common leading whitespace stripped, and truncated to the
 * {@link MAX_SNIPPET_CHARS} cap. Returns `undefined` when the source
 * is empty, the line is out of bounds, or the resulting snippet is
 * empty after trimming — callers conditional-spread on the result.
 *
 * Cap strategy: the target line is load-bearing; prefer keeping it
 * plus as much trailing context as fits, then backfill preceding
 * context. This matches how agents scan — the line the finding
 * pointed at is the anchor, the trailing lines show what the element
 * does next.
 */
export function buildSnippet(source: string, line: number): string | undefined {
  if (typeof source !== "string" || source.length === 0) return undefined;
  if (!Number.isInteger(line) || line < 1) return undefined;

  const lines = source.split("\n");
  if (line > lines.length) return undefined;

  const start = Math.max(0, line - 1 - CONTEXT_LINES);
  const end = Math.min(lines.length, line + CONTEXT_LINES);
  const window = lines.slice(start, end);
  if (window.length === 0) return undefined;

  const deindented = stripCommonIndent(window);

  // Fast path: the natural window fits. Nothing to shrink.
  const joined = deindented.join("\n");
  if (joined.length <= MAX_SNIPPET_CHARS) {
    return joined.length > 0 ? joined : undefined;
  }

  // Shrink path: keep the target line, then as much trailing context
  // as fits, then backfill preceding context. Windows are never empty
  // here (start ≤ line-1 < end), so `anchor` is always within range.
  const anchor = Math.min(line - 1 - start, deindented.length - 1);
  const shrunk = shrinkAroundAnchor(deindented, anchor, MAX_SNIPPET_CHARS);
  return shrunk.length > 0 ? shrunk : undefined;
}

/**
 * Computes the longest leading-whitespace prefix common to all
 * non-blank lines in `window`, and strips it from every line. Blank
 * lines contribute no indent floor (otherwise a single blank line
 * collapses the strip to zero). Mixed tab/space lines are handled
 * character-wise: the strip only removes as much as literally matches
 * on every line.
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
 * Shrinks a line array around `anchor` (0-indexed) to fit under
 * `cap` characters including join newlines. Keeps the anchor first,
 * then extends forward one line at a time, then backward. Returns a
 * string (possibly shorter than the anchor line if the anchor alone
 * exceeds the cap — in that case we truncate and append an ellipsis
 * marker so the agent knows it was cut).
 */
function shrinkAroundAnchor(lines: readonly string[], anchor: number, cap: number): string {
  const anchorLine = lines[anchor] ?? "";
  if (anchorLine.length > cap) {
    // Truncate from the right; keep it as one line.
    const marker = "…";
    return `${anchorLine.slice(0, Math.max(0, cap - marker.length))}${marker}`;
  }

  let out = anchorLine;
  let forward = anchor + 1;
  let backward = anchor - 1;

  // Prefer trailing context first (see buildSnippet docstring).
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
