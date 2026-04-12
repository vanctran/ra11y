/**
 * ra11y plugin API.
 *
 * This is the public surface that rules, standards, formatters, and configs
 * are authored against. Every helper here is a pass-through identity function
 * that exists for two reasons:
 *
 *   1. **Type inference**: `defineRule({ … })` gives you full intellisense
 *      on every field without having to restate the type. The helper asserts
 *      the argument extends the canonical type, and TypeScript infers the
 *      literal types for string fields like `id`, `severity`, `scope`.
 *   2. **Refactor safety**: if the Rule/Standard/Formatter shape ever
 *      evolves, the define helper is the single point where the migration
 *      runs — every downstream rule automatically picks up the new shape.
 *
 * These helpers are zero-cost at runtime (they return their argument
 * verbatim) and impose no dependency load — they live inside ra11y and are
 * re-exported via `@ra11y/core/plugin`.
 *
 * See docs/kb/patterns/writing-a-rule.md.
 */

import type { Config } from "../types/config.ts";
import type { CandidateFinder } from "../types/review.ts";
import type { Rule } from "../types/rule.ts";
import type { Standard } from "../types/standard.ts";
import type { ReportData, ScanResult } from "../types/violation.ts";

/**
 * Defines a ra11y rule. Returns the same object, typed.
 *
 * @example
 * ```ts
 * export const rule = defineRule({
 *   id: "contrast/minimum",
 *   satisfies: ["wcag22:1.4.3", "wcag21:1.4.3"],
 *   severity: "error",
 *   scope: "node",
 *   docs: { …rich metadata… },
 *   check(ctx) { … },
 * });
 * ```
 */
export function defineRule<T extends Rule>(rule: T): T {
  return rule;
}

/**
 * Defines an accessibility standard as pure data.
 *
 * @example
 * ```ts
 * export const standard = defineStandard({
 *   id: "wcag22",
 *   name: "WCAG 2.2",
 *   version: "2.2",
 *   publisher: "W3C",
 *   url: "https://www.w3.org/TR/WCAG22/",
 *   levels: ["A", "AA", "AAA"],
 *   criteria: [ … ],
 * });
 * ```
 */
export function defineStandard<T extends Standard>(standard: T): T {
  return standard;
}

/** Signature of an output formatter. Pure function; no I/O. */
export type FormatterFn = (result: ScanResult, report: ReportData) => string;

/** Formatter record. */
export interface Formatter {
  readonly id: string;
  readonly format: FormatterFn;
}

/**
 * Defines an output formatter.
 *
 * @example
 * ```ts
 * export const formatter = defineFormatter({
 *   id: "json",
 *   format(result, report) { return JSON.stringify({ result, report }, null, 2); },
 * });
 * ```
 */
export function defineFormatter<T extends Formatter>(formatter: T): T {
  return formatter;
}

/**
 * Defines a ra11y user config. Accepts the partial `Config` shape and lets
 * the loader fill in defaults.
 *
 * @example
 * ```ts
 * import { defineConfig } from "@ra11y/core";
 * export default defineConfig({ standards: ["wcag22"], level: "AA" });
 * ```
 */
export function defineConfig(config: Config): Config {
  return config;
}

/**
 * Defines a candidate finder for assisted manual review. Returns the
 * same object, typed.
 *
 * @example
 * ```ts
 * export const finder = defineCandidateFinder({
 *   id: "review/media-alternatives",
 *   criterionIds: ["wcag22:1.2.1", "wcag22:1.2.3", "wcag22:1.2.5"],
 *   scope: "node",
 *   docs: { …metadata… },
 *   find(ctx) { … },
 * });
 * ```
 */
export function defineCandidateFinder<T extends CandidateFinder>(finder: T): T {
  return finder;
}
