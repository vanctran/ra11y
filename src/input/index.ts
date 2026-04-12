/**
 * Input layer barrel. Exposes parsers and (eventually) file discovery.
 */

export type { HtmlParseResult, TsxParseResult } from "./parsers/index.ts";
export { parseHtml, parseTsx } from "./parsers/index.ts";
