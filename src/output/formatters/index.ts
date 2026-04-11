/**
 * Formatter registry. Built-in formatters exposed as a map keyed by ID
 * so the CLI's --format validator can resolve by string.
 */

import type { Formatter } from "../../api/plugin.ts";
import { jsonFormatter } from "./json.ts";
import { plainFormatter } from "./plain.ts";
import { terminalFormatter } from "./terminal.ts";

export const BUILTIN_FORMATTERS: Readonly<Record<string, Formatter>> = {
  terminal: terminalFormatter,
  json: jsonFormatter,
  plain: plainFormatter,
};

export { jsonFormatter, plainFormatter, terminalFormatter };
