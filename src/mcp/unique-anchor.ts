/**
 * Widen a `suggest_fix` `{ oldText, newText }` pair into a literal
 * find-and-replace window that matches **exactly once** inside the file.
 *
 * The bare edit a rule emits — e.g. `aria-hidden="true"` → `inert` — is
 * the semantically minimal swap, but it collides on any file that has
 * two such attributes. `apply_fix` refuses to apply non-unique edits
 * (by design: silent misapplication is the worst failure mode), so an
 * agent that hits the collision has to manually widen the anchor from
 * `sourceContext`. That round-trip is waste the tool can pre-empt.
 *
 * This module widens both sides of the edit symmetrically, wrapping the
 * inner replacement region with surrounding context drawn from the
 * actual source. The widening ladder, smallest-to-largest:
 *
 *   1. **Surrounding opening-tag attribute cluster.** If the target
 *      occurrence sits inside a `<...>` opening tag, wrap the edit with
 *      that whole tag — `<button aria-hidden="true" disabled>` →
 *      `<button inert disabled>`. This is by far the common case for
 *      attribute-level edits and it's usually sufficient for uniqueness
 *      even when the bare attribute repeats.
 *   2. **±1 line around the target.** Takes in the preceding/following
 *      line as context — enough to disambiguate when two tags on
 *      different lines share the same attribute shape.
 *   3. **Containing-bracket window.** Walk outward through the nearest
 *      enclosing `<...>` tag pair / `{...}` block, expanding until the
 *      window is unique. Terminates at the 200-char cap.
 *
 * Hard cap: 200 chars total. If no step in the ladder yields a unique
 * window inside the cap, fall back to the original narrow `oldText`
 * plus a `caveat` string so the caller can surface the ambiguity to the
 * agent rather than silently shipping a colliding edit.
 *
 * The `line` parameter names which occurrence we're widening around —
 * the violation's reported line. A rule that emits an edit for the
 * second of two `aria-hidden="true"` attributes in a file needs the
 * widen to anchor at the second occurrence, not the first.
 *
 * Pure function, zero deps. Used by `suggest_fix` only; `apply_fix`
 * consumes the widened `{ oldText, newText }` through its normal literal
 * match + uniqueness path — no special casing there.
 */

export interface WidenInput {
  readonly source: string;
  readonly oldText: string;
  readonly newText: string;
  /** 1-based line of the violation this edit targets. */
  readonly line: number;
}

export interface WidenResult {
  readonly oldText: string;
  readonly newText: string;
  /**
   * Present only when the widen could not find a unique anchor inside
   * the character cap — the caller falls back to the original narrow
   * `oldText` and surfaces this string to the agent so it can add its
   * own disambiguating context before calling `apply_fix`. Absent when
   * the returned `oldText` is unique.
   */
  readonly caveat?: string;
}

/** Hard cap on widened oldText length. Above this we prefer the caveat path. */
const MAX_ANCHOR_CHARS = 200;

const NO_UNIQUE_ANCHOR_CAVEAT =
  "anchor not unique; multiple matches possible. Widen oldText with disambiguating context from sourceContext before calling apply_fix.";

export function widenToUniqueAnchor(input: WidenInput): WidenResult {
  const { source, oldText, newText, line } = input;
  const total = countOccurrences(source, oldText);
  // Zero matches → pass through untouched. The caller / apply_fix will
  // surface the no-match condition with its own structured error; this
  // helper doesn't synthesize matches that don't exist.
  if (total === 0) return { oldText, newText };

  const target = findTargetOccurrence(source, oldText, line);
  if (target === null) return { oldText, newText };

  // Ladder step 1: surrounding opening-tag attribute cluster. Cheap to
  // compute, and it's the right answer on the common case where the
  // minimal oldText is an attribute inside a single opening tag.
  const tag = tagWindow(source, target, oldText);
  if (tag && tag.windowed.length <= MAX_ANCHOR_CHARS) {
    if (countOccurrences(source, tag.windowed) === 1) {
      return {
        oldText: tag.windowed,
        newText: wrapNewText(tag, oldText, newText),
      };
    }
  }

  // Ladder step 2: ±1 line window. Picks up enough neighboring tokens
  // to disambiguate identical tags on sibling lines (common in lists).
  const lineExp = lineWindow(source, target, oldText);
  if (lineExp && lineExp.windowed.length <= MAX_ANCHOR_CHARS) {
    if (countOccurrences(source, lineExp.windowed) === 1) {
      return {
        oldText: lineExp.windowed,
        newText: wrapNewText(lineExp, oldText, newText),
      };
    }
  }

  // Ladder step 3: expand outward through surrounding characters until
  // the window is unique or the cap is hit. Symmetric expansion keeps
  // the anchor centered on the target so the `newText` wrap stays
  // balanced byte-for-byte.
  const bracket = bracketWindow(source, target, oldText);
  if (bracket && bracket.windowed.length <= MAX_ANCHOR_CHARS) {
    if (countOccurrences(source, bracket.windowed) === 1) {
      return {
        oldText: bracket.windowed,
        newText: wrapNewText(bracket, oldText, newText),
      };
    }
  }

  // No unique anchor fits in the cap. Fall back to the narrow edit and
  // attach a caveat so the caller can surface the ambiguity honestly.
  // A silent colliding edit is the failure mode `apply_fix` exists to
  // prevent; the caveat carries that signal one call earlier.
  return { oldText, newText, caveat: NO_UNIQUE_ANCHOR_CAVEAT };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Window {
  /** The widened source slice. */
  readonly windowed: string;
  /** Bytes of prefix context wrapping the inner oldText. */
  readonly prefix: string;
  /** Bytes of suffix context wrapping the inner oldText. */
  readonly suffix: string;
}

function wrapNewText(win: Window, oldText: string, newText: string): string {
  // The inner replacement region is the bytes between prefix and suffix
  // — by construction equal to the original oldText exactly once. We
  // rebuild the widened newText as `prefix + newText + suffix` so both
  // sides of the edit share identical anchor context byte-for-byte.
  // Sanity: prefix + oldText + suffix must equal windowed; if it
  // doesn't, something drifted and we bail to the unwrapped edit.
  if (`${win.prefix}${oldText}${win.suffix}` !== win.windowed) return newText;
  return `${win.prefix}${newText}${win.suffix}`;
}

function countOccurrences(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = source.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = source.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Returns the byte offset of the `oldText` occurrence whose starting
 * line is closest to `line` — the violation's reported line. Falls
 * back to the first occurrence when the line offset can't be resolved.
 */
function findTargetOccurrence(source: string, oldText: string, line: number): number | null {
  if (oldText.length === 0) return null;
  let bestIdx: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  let idx = source.indexOf(oldText);
  while (idx !== -1) {
    const occLine = lineOfOffset(source, idx);
    const delta = Math.abs(occLine - line);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = idx;
    }
    idx = source.indexOf(oldText, idx + oldText.length);
  }
  return bestIdx;
}

function lineOfOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * If the target occurrence sits inside a `<...>` opening tag on a
 * single line, return that tag as the window. Returns null when we
 * can't cleanly identify an enclosing tag (e.g. the edit spans
 * multiple lines, or the `<` / `>` boundary is ambiguous).
 */
function tagWindow(source: string, target: number, oldText: string): Window | null {
  const end = target + oldText.length;
  // Walk left from `target` until we see `<` or a line break.
  let left = target;
  while (left > 0) {
    const ch = source.charCodeAt(left - 1);
    if (ch === 60 /* < */) break; // found the opening
    if (ch === 10 /* \n */) return null; // crossed a line — not a single tag
    left -= 1;
  }
  if (left === 0 || source.charCodeAt(left - 1) !== 60) return null;
  const tagStart = left - 1; // include the `<`

  // Walk right from `end` until we see `>` or a line break.
  let right = end;
  while (right < source.length) {
    const ch = source.charCodeAt(right);
    if (ch === 62 /* > */) {
      right += 1; // include the `>`
      break;
    }
    if (ch === 10 /* \n */) return null;
    right += 1;
  }
  if (right === source.length || source.charCodeAt(right - 1) !== 62) return null;

  const windowed = source.slice(tagStart, right);
  const prefix = source.slice(tagStart, target);
  const suffix = source.slice(end, right);
  return { windowed, prefix, suffix };
}

/** ±1 line window around the target occurrence. */
function lineWindow(source: string, target: number, oldText: string): Window | null {
  const end = target + oldText.length;
  // Walk left to the start of the previous line (or start of file).
  const startOfLine = lastLineBreakBefore(source, target) + 1;
  const prevLineStart = startOfLine > 0 ? lastLineBreakBefore(source, startOfLine - 1) + 1 : 0;
  // Walk right to the end of the next line (or end of file).
  const endOfLine = nextLineBreakFrom(source, end);
  const nextLineEnd =
    endOfLine < source.length ? nextLineBreakFrom(source, endOfLine + 1) : endOfLine;

  const windowed = source.slice(prevLineStart, nextLineEnd);
  const prefix = source.slice(prevLineStart, target);
  const suffix = source.slice(end, nextLineEnd);
  return { windowed, prefix, suffix };
}

function lastLineBreakBefore(source: string, offset: number): number {
  for (let i = offset - 1; i >= 0; i -= 1) {
    if (source.charCodeAt(i) === 10) return i;
  }
  return -1;
}

function nextLineBreakFrom(source: string, offset: number): number {
  for (let i = offset; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) return i;
  }
  return source.length;
}

/**
 * Expand outward one character at a time, alternating left/right, until
 * the window is unique or the cap is hit. Stops at line breaks that
 * would push the window past its enclosing brace/bracket — keeping it
 * readable for the agent that has to eyeball the replacement.
 */
function bracketWindow(source: string, target: number, oldText: string): Window | null {
  const end = target + oldText.length;
  let left = target;
  let right = end;
  // Grow symmetrically until unique or cap.
  while (right - left < MAX_ANCHOR_CHARS) {
    const grewLeft = left > 0;
    const grewRight = right < source.length;
    if (!(grewLeft || grewRight)) break;
    if (grewLeft) left -= 1;
    if (grewRight) right += 1;
    if (right - left > MAX_ANCHOR_CHARS) break;
    const slice = source.slice(left, right);
    if (countOccurrences(source, slice) === 1) {
      return {
        windowed: slice,
        prefix: source.slice(left, target),
        suffix: source.slice(end, right),
      };
    }
  }
  return null;
}
