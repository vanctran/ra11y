/**
 * Terminal-aware text wrapping.
 *
 * Wraps a message to a target display column count using
 * `stringWidth` so CJK, emoji, and combining marks count correctly
 * (the width, not the UTF-16 code-unit length). ANSI escape
 * sequences are also preserved — they have zero display width and
 * must not trigger a line break.
 *
 * Not a general-purpose wrapper. Designed for the terminal
 * formatter's long message/suggestion strings where we want:
 *   - preserve explicit \n as hard breaks
 *   - prefer word boundaries
 *   - fall back to mid-word break if a single token exceeds the
 *     target width (rare, but URLs happen)
 */

import { stripAnsi } from "./ansi.ts";
import { stringWidth } from "./string-width.ts";

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 4;

/**
 * Wrap `text` to at most `targetCols` display columns per line.
 * Preserves existing newlines. If a single word exceeds the target,
 * it gets its own line rather than being truncated — long URLs,
 * stack frames, etc. still render fully.
 */
export function wrapText(text: string, targetCols = DEFAULT_WIDTH): string {
  const width = Math.max(MIN_WIDTH, targetCols | 0);
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine === "") {
      out.push("");
      continue;
    }
    out.push(...wrapLine(rawLine, width));
  }
  return out.join("\n");
}

interface WrapState {
  lines: string[];
  current: string;
  width: number; // running display-cell width of `current`
}

function wrapLine(line: string, width: number): string[] {
  if (stringWidth(line) <= width) return [line];
  const state: WrapState = { lines: [], current: "", width: 0 };
  for (const tok of line.split(/(\s+)/)) {
    if (tok !== "") consumeToken(state, tok, width);
  }
  flush(state);
  return state.lines;
}

function consumeToken(state: WrapState, tok: string, width: number): void {
  const w = stringWidth(tok);
  if (state.width + w <= width) {
    state.current += tok;
    state.width += w;
    return;
  }
  if (/^\s+$/.test(tok)) {
    flush(state);
    return;
  }
  flush(state);
  if (w > width) {
    for (const chunk of splitWideToken(tok, width)) state.lines.push(chunk);
    return;
  }
  state.current = tok;
  state.width = w;
}

function flush(state: WrapState): void {
  if (state.current !== "") state.lines.push(state.current.trimEnd());
  state.current = "";
  state.width = 0;
}

/**
 * Splits a single over-wide token into chunks of ≤ width display
 * cells, preserving ANSI escape sequences. Uses code-point
 * iteration so we don't split a surrogate pair or a CJK character
 * in half.
 */
function splitWideToken(token: string, width: number): string[] {
  const chunks: string[] = [];
  let acc = "";
  let accWidth = 0;
  for (const ch of token) {
    const w = stringWidth(stripAnsi(ch));
    if (accWidth + w > width && acc !== "") {
      chunks.push(acc);
      acc = "";
      accWidth = 0;
    }
    acc += ch;
    accWidth += w;
  }
  if (acc !== "") chunks.push(acc);
  return chunks;
}
