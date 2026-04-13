/**
 * Input layer barrel. Exposes parsers, resolvers, and (eventually)
 * file discovery.
 */

export type { HtmlParseResult, TsxParseResult } from "./parsers/index.ts";
export { parseHtml, parseTsx } from "./parsers/index.ts";
export type { ResolvedDeclaration } from "./resolvers/theme.ts";
export { resolveTailwindClasses, resolveTailwindToken } from "./resolvers/theme.ts";
