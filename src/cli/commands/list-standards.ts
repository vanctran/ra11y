/**
 * `ra11y --list-standards` — prints every loaded standard with its
 * version, publisher, URL, and criterion counts broken down by level.
 */

import { wcag22 } from "../../standards/wcag22/standard.ts";
import type { Standard } from "../../types/standard.ts";
import type { ScanExit } from "./scan.ts";

const LOADED: readonly Standard[] = [wcag22];

export function runListStandards(): ScanExit {
  const lines: string[] = [];
  lines.push("");
  lines.push("  Standards:");
  lines.push("");
  for (const std of LOADED) {
    lines.push(`    ${std.id}  ${std.name} v${std.version}  (${std.publisher})`);
    lines.push(`      ${std.url}`);
    const counts = countByLevel(std);
    lines.push(`      criteria: ${std.criteria.length} total · ${renderCounts(counts)}`);
    lines.push("");
  }
  lines.push(`  ${LOADED.length} standard${LOADED.length === 1 ? "" : "s"} loaded.`);
  lines.push("");
  return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
}

function countByLevel(std: Standard): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of std.criteria) {
    counts[c.level] = (counts[c.level] ?? 0) + 1;
  }
  return counts;
}

function renderCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([level, count]) => `${count} ${level}`)
    .join(", ");
}
