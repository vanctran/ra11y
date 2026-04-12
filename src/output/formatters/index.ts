/**
 * Formatter registry. Built-in formatters exposed via a typed record
 * (not a generic Record<string, Formatter> — that's an index signature
 * and would force bracket-notation access at every call site). The
 * shape is closed; adding a new formatter means adding a field here
 * and updating the CliOptions.format union in src/cli/args.ts.
 */

import type { Formatter } from "../../api/plugin.ts";
import { agentFormatter } from "./agent.ts";
import { jsonFormatter } from "./json.ts";
import { junitFormatter } from "./junit.ts";
import { markdownFormatter } from "./markdown.ts";
import { plainFormatter } from "./plain.ts";
import { sarifFormatter } from "./sarif.ts";
import { terminalFormatter } from "./terminal.ts";

export interface BuiltinFormatters {
  readonly terminal: Formatter;
  readonly json: Formatter;
  readonly plain: Formatter;
  readonly sarif: Formatter;
  readonly junit: Formatter;
  readonly markdown: Formatter;
  readonly agent: Formatter;
}

export const BUILTIN_FORMATTERS: BuiltinFormatters = {
  terminal: terminalFormatter,
  json: jsonFormatter,
  plain: plainFormatter,
  sarif: sarifFormatter,
  junit: junitFormatter,
  markdown: markdownFormatter,
  agent: agentFormatter,
};

export {
  agentFormatter,
  jsonFormatter,
  junitFormatter,
  markdownFormatter,
  plainFormatter,
  sarifFormatter,
  terminalFormatter,
};
