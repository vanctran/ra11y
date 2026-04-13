#!/usr/bin/env bun
/**
 * Confirms docs/kb/ is in sync with rule and standard metadata:
 *   - docs/kb/rules/<slug>.md exists for every rule in src/rules/
 *   - docs/kb/standards/<id>.md exists for every loaded standard
 *   - docs/kb/wcag/<sc>.md exists for every WCAG 2.2 criterion
 *   - no stale entries in any of the above
 *
 * If anything is missing or stale, re-run the matching generator
 * (generate-rule-kb, generate-wcag-kb, etc.).
 *
 * Exits 0 if clean, 1 on drift.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_RULES } from "../src/rules/index.ts";
import { WCAG22_CRITERIA } from "../src/standards/wcag22/criteria.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");

const expectedRules = BUILTIN_RULES.map((r) => r.id.replace(/\//g, "__")).sort();
const expectedWcag = WCAG22_CRITERIA.map((c) =>
  c.id.replace(/^wcag22:/, "").replace(/\./g, "-"),
).sort();
const expectedStandards = ["wcag22", "wcag21", "section508", "en301549"];

const issues: string[] = [];
diff("docs/kb/rules", expectedRules);
diff("docs/kb/wcag", expectedWcag);
diff("docs/kb/standards", expectedStandards);

if (issues.length > 0) {
  console.error(`✗ docs/kb/ drift (${issues.length}):\n`);
  for (const msg of issues) console.error(`  ${msg}`);
  console.error("\nFix: run the matching generate-*-kb.ts script, or /fix-drift.");
  process.exit(1);
}

const total = expectedRules.length + expectedWcag.length + expectedStandards.length;
console.log(`✓ docs/kb/ in sync (${total} entries)`);
process.exit(0);

function diff(relDir: string, expected: readonly string[]): void {
  const dir = join(ROOT, relDir);
  const actual = new Set<string>();
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".md") && name !== "index.md" && name !== "README.md") {
        actual.add(name.slice(0, -3));
      }
    }
  } catch {
    /* dir missing is fine — report via expected set */
  }
  for (const slug of expected) {
    if (!actual.has(slug)) issues.push(`${relDir}/${slug}.md  MISSING`);
  }
  for (const slug of actual) {
    if (!expected.includes(slug)) issues.push(`${relDir}/${slug}.md  STALE (no source)`);
  }
}
