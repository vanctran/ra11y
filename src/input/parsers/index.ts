/**
 * Parser barrel — one entry point per input language. The scanner
 * dispatches to these based on file extension.
 */

export type { CssParseResult } from "./css.ts";
export { parseCss } from "./css.ts";
export type { HtmlParseResult } from "./html.ts";
export { parseHtml } from "./html.ts";
export type { TsxParseResult } from "./tsx.ts";
export { parseTsx } from "./tsx.ts";
