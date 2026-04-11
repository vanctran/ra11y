/**
 * Layout helpers for the terminal formatter — tables, boxes, wrapping.
 *
 * Every helper is pure. Visual output is composed by chaining these:
 * `renderFileGroup("src/ui/Card.tsx", lines)` → a full box. The caller
 * controls whether to emit decorated or plain text by choosing which
 * helpers to use.
 */

import { padRight, stringWidth } from "../../utils/string-width.ts";
import { BOX } from "./symbols.ts";

/** Horizontal rule of box-drawing characters. */
export function horizontalRule(width: number): string {
  return BOX.horizontal.repeat(Math.max(0, width));
}

/** Prepends a vertical bar + 2-space indent to every line. */
export function gutter(lines: readonly string[]): string[] {
  return lines.map((line) => `${BOX.vertical}  ${line}`);
}

/**
 * Builds a file-group box with a labeled top border and a closing
 * bottom border. The label is dimmed and separated from the rule by
 * an en-dash.
 */
export function renderFileBox(label: string, body: readonly string[]): string {
  // Top line: ┌─ label ─── (to 64 cols visible)
  const TARGET_WIDTH = 64;
  const labelText = ` ${label} `;
  const prefix = `${BOX.topLeft}${BOX.horizontal}`;
  const suffix = `${BOX.horizontal}`;
  const rulePaddingWidth = Math.max(
    3,
    TARGET_WIDTH - stringWidth(prefix) - stringWidth(labelText) - stringWidth(suffix),
  );
  const top = `${prefix}${labelText}${BOX.horizontal.repeat(rulePaddingWidth)}${suffix}`;
  const bodyLines = [`${BOX.vertical}`, ...gutter(body), `${BOX.vertical}`];
  const bottom = `${BOX.bottomLeft}${horizontalRule(TARGET_WIDTH - 1)}`;
  return [top, ...bodyLines, bottom].join("\n");
}

/** Pads every line of a block to a shared visible width. */
export function alignBlock(lines: readonly string[]): string[] {
  let max = 0;
  for (const line of lines) {
    const w = stringWidth(line);
    if (w > max) max = w;
  }
  return lines.map((line) => padRight(line, max));
}
