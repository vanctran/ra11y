/**
 * Top-level rule-catalog map for scan responses.
 *
 * When agents want to triage findings without a per-rule `explain_rule`
 * round-trip, they can request `includeRuleDetails: "unique"` (details
 * for every unique ruleId that fired in the scan) or `"all"` (the full
 * loaded rule catalog, for first-contact workflows that want a single
 * cache). Default `"none"` keeps the baseline response shape.
 *
 * Kept as a separate module so `tools-helpers.ts` stays under the
 * 500-line budget and the projection shape is easy to find when adding
 * a new field to `RuleDocs`.
 */

import type { Rule } from "../types/rule.ts";

/** The three legal values of `includeRuleDetails`. */
export type IncludeRuleDetails = "none" | "unique" | "all";

/**
 * JSON-Schema fragment shared by every tool that accepts
 * `includeRuleDetails`. Exporting as a constant rather than re-inlining
 * keeps the copy in one place and lets scan / scan_project stay under
 * their file-line budgets.
 */
export const includeRuleDetailsSchema = {
  type: "string",
  enum: ["none", "unique", "all"],
  description:
    "Inline rule-catalog entries (description, rationale, examples, references, normativeQuote) at the top of the response so agents can triage findings without a per-rule `explain_rule` round-trip. `unique` includes only rules that fired; `all` includes the full loaded catalog (larger but one-shot). Default `none` keeps the baseline shape.",
} as const;

/**
 * Reads `includeRuleDetails` from the tool params. Unknown strings
 * coerce to `"none"` rather than throw — the schema guards at the MCP
 * layer already reject invalid enum values, so this is a belt-and-
 * suspenders default for direct (non-MCP) callers.
 */
export function parseIncludeRuleDetails(raw: unknown): IncludeRuleDetails {
  if (raw === "unique" || raw === "all") return raw;
  return "none";
}

/** One entry in the catalog — mirrors `RuleDocs` with the ruleId baked in. */
export interface RuleCatalogEntry {
  readonly description: string;
  readonly rationale: string;
  readonly normativeQuote: string | null;
  readonly goodExample: string;
  readonly badExample: string;
  readonly references: readonly string[];
}

/**
 * Builds `{ [ruleId]: RuleCatalogEntry }` from a list of rules + the
 * caller's mode. Returns `undefined` when the mode is `"none"` or when
 * there are no rules to describe — the caller conditional-spreads the
 * whole block away (honest shape per CLAUDE.md §1 — no `{}` sentinel).
 *
 * `"unique"` includes only rules whose IDs appear in `firedRuleIds`.
 * `"all"` includes every rule in `allRules`, useful when the agent
 * wants the full rule catalog cached in one response.
 */
export function buildRuleCatalog(
  mode: IncludeRuleDetails,
  allRules: readonly Rule[],
  firedRuleIds: ReadonlySet<string>,
): Record<string, RuleCatalogEntry> | undefined {
  if (mode === "none") return undefined;
  const pool = mode === "all" ? allRules : allRules.filter((r) => firedRuleIds.has(r.id));
  if (pool.length === 0) return undefined;
  const out: Record<string, RuleCatalogEntry> = {};
  for (const rule of [...pool].sort((a, b) => a.id.localeCompare(b.id))) {
    out[rule.id] = {
      description: rule.docs.description,
      rationale: rule.docs.rationale,
      normativeQuote: rule.docs.normativeQuote ?? null,
      goodExample: rule.docs.goodExample,
      badExample: rule.docs.badExample,
      references: [...rule.docs.references],
    };
  }
  return out;
}

/**
 * Walks a formatted `files` array and collects the set of unique ruleIds
 * that appear in any finding. Used to drive the `"unique"` mode when
 * the caller wants catalog entries only for rules that actually fired.
 */
export function collectFiredRuleIds(
  files: readonly { readonly findings: readonly unknown[] }[],
): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    for (const raw of file.findings) {
      if (raw && typeof raw === "object") {
        const id = (raw as Record<string, unknown>)["ruleId"];
        if (typeof id === "string") ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Conditional-spread helper: reads `includeRuleDetails` from params,
 * builds the catalog, and returns the empty object when disabled. Lets
 * callers spread unconditionally into the response.
 */
export function ruleCatalogField(
  params: Record<string, unknown>,
  rules: readonly Rule[],
  files: readonly { readonly findings: readonly unknown[] }[],
): { readonly ruleCatalog?: Record<string, RuleCatalogEntry> } {
  const catalog = buildRuleCatalog(
    parseIncludeRuleDetails(params["includeRuleDetails"]),
    rules,
    collectFiredRuleIds(files),
  );
  if (catalog === undefined) return {};
  return { ruleCatalog: catalog };
}
