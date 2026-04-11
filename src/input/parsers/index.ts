/**
 * Parser barrel — one entry point per input language. The scanner
 * dispatches to these based on file extension.
 */

export { parseHtml } from "./html.ts";
export type { HtmlParseResult } from "./html.ts";
export { parseTsx } from "./tsx.ts";
export type { TsxParseResult } from "./tsx.ts";
