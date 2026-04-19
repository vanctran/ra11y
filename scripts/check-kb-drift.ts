#!/usr/bin/env bun
/**
 * Confirms docs/kb/ is in sync with rule and standard metadata:
 *   - docs/kb/rules/<slug>.md exists for every rule in src/rules/
 *   - docs/kb/standards/<id>.md exists for every loaded standard
 *   - docs/kb/wcag/<sc>.md exists for every WCAG 2.2 criterion
 *   - docs/kb/standards/coverage.md matches generated output
 *   - no stale entries in any of the above
 *
 * If anything is missing or stale, re-run the matching generator
 * (generate-rule-kb, generate-wcag-kb, generate-coverage-matrix, etc.).
 *
 * Exits 0 if clean, 1 on drift.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_RULES } from "../src/rules/index.ts";
import { WCAG22_CRITERIA } from "../src/standards/wcag22/criteria.ts";
import { generateCoverageMatrix } from "./generate-coverage-matrix.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");

const expectedRules = BUILTIN_RULES.map((r) => r.id.replace(/\//g, "__")).sort();
const expectedWcag = WCAG22_CRITERIA.map((c) =>
  c.id.replace(/^wcag22:/, "").replace(/\./g, "-"),
).sort();
const expectedStandards = ["wcag22", "wcag21", "section508", "en301549"];

const issues: string[] = [];
diff("docs/kb/rules", expectedRules);
diff("docs/kb/wcag", expectedWcag);
diffStandards("docs/kb/standards", expectedStandards);
checkCoverageMatrix();

if (issues.length > 0) {
  console.error(`✗ docs/kb/ drift (${issues.length}):\n`);
  for (const msg of issues) console.error(`  ${msg}`);
  console.error("\nFix: run the matching generate-*-kb.ts script, or /fix-drift.");
  process.exit(1);
}

const total = expectedRules.length + expectedWcag.length + expectedStandards.length;
console.log(`✓ docs/kb/ in sync (${total} entries + coverage matrix)`);
process.exit(0);

/**
 * Checks that docs/kb/standards/coverage.md matches regenerated output.
 * The generated file includes a `generated:` date field; we normalise it
 * before comparing so a date-only change does not cause a false positive.
 */
function checkCoverageMatrix(): void {
  const coveragePath = join(ROOT, "docs", "kb", "standards", "coverage.md");
  let onDisk: string;
  try {
    onDisk = readFileSync(coveragePath, "utf8");
  } catch {
    issues.push("docs/kb/standards/coverage.md  MISSING");
    return;
  }
  const regenerated = generateCoverageMatrix();
  const normalise = (s: string) => s.replace(/^generated: ".*?"$/m, 'generated: "DATE"');
  if (normalise(onDisk) !== normalise(regenerated)) {
    issues.push(
      "docs/kb/standards/coverage.md  DRIFT (run: bun scripts/generate-coverage-matrix.ts)",
    );
  }
}

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

/**
 * Like diff() but permits extra *.md files in the standards directory —
 * coverage.md and any future generated files should not be flagged as stale
 * since they are tracked separately via checkCoverageMatrix().
 */
function diffStandards(relDir: string, expected: readonly string[]): void {
  const dir = join(ROOT, relDir);
  const knownExtras = new Set(["coverage"]);
  const actual = new Set<string>();
  try {
    for (const name of readdirSync(dir)) {
      if (
        name.endsWith(".md") &&
        name !== "index.md" &&
        name !== "README.md" &&
        !knownExtras.has(name.slice(0, -3))
      ) {
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
