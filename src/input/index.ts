/**
 * Input layer barrel. Exposes parsers and (eventually) file discovery.
 */

export { parseHtml, parseTsx } from "./parsers/index.ts";
export type { HtmlParseResult, TsxParseResult } from "./parsers/index.ts";
