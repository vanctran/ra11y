/**
 * The `explain_standard` MCP tool. Parallels `explain_rule`: pass a
 * standard ID, get the full criterion list plus metadata an agent
 * can reason about without having to import the scanner's type
 * system.
 *
 * Rule-centric `list_rules` was already in place; this is the
 * standard-centric mirror agents asked for when drafting a VPAT or
 * comparing coverage across standards.
 */

import { BUILTIN_STANDARDS } from "../standards/index.ts";
import { errorResult, type McpTool, strParam, textResult } from "./tools-helpers.ts";

export const explainStandardTool: McpTool = {
  def: {
    name: "explain_standard",
    description:
      "Return metadata + criterion list for a loaded standard (wcag22, wcag21, section508, en301549). Use when drafting a VPAT, comparing coverage across standards, or picking which criteria to surface in a manual review.",
    inputSchema: {
      type: "object",
      properties: {
        standardId: {
          type: "string",
          description: "Standard identifier (e.g. wcag22, section508, en301549).",
        },
        level: {
          type: "string",
          enum: ["A", "AA", "AAA"],
          description: "Optional. Filter criteria to this level and below (AA returns A + AA).",
        },
      },
      required: ["standardId"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler(params) {
    const id = strParam(params, "standardId");
    if (!id) return errorResult("standardId must be a non-empty string.");

    const standard = BUILTIN_STANDARDS.find((s) => s.id === id);
    if (!standard) {
      const known = BUILTIN_STANDARDS.map((s) => s.id).join(", ");
      return errorResult(`Unknown standard '${id}'. Loaded: ${known}.`);
    }

    const level = strParam(params, "level");
    const criteria = level ? filterByLevel(standard.criteria, level) : standard.criteria;

    return textResult({
      id: standard.id,
      name: standard.name,
      version: standard.version,
      publisher: standard.publisher ?? null,
      url: standard.url ?? null,
      levels: standard.levels,
      levelFilterApplied: level ?? null,
      criteriaCount: criteria.length,
      criteria: criteria.map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
        automatable: c.automatable ?? "unknown",
        url: c.url ?? null,
        equivalentTo: c.equivalentTo ?? [],
      })),
    });
  },
};

function filterByLevel(
  criteria: (typeof BUILTIN_STANDARDS)[number]["criteria"],
  level: string,
): typeof criteria {
  const rank: Record<string, number> = { A: 1, AA: 2, AAA: 3 };
  const ceiling = rank[level] ?? 3;
  return criteria.filter((c) => (rank[c.level] ?? 0) <= ceiling);
}
