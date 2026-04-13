#!/usr/bin/env bun
/**
 * Confirms that every public-API symbol has a docs/api/<symbol>.md
 * entry and that there are no docs/api/ pages for symbols that no
 * longer exist.
 *
 * The public API surface is whatever is exported from src/index.ts
 * and src/api/plugin.ts (the `.` and `./plugin` package entries per
 * package.json).
 *
 * Exits 0 if clean, 1 on drift.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");
const API_DOCS_DIR = join(ROOT, "docs", "api");

const ENTRIES = [join(SRC_DIR, "index.ts"), join(SRC_DIR, "api", "plugin.ts")].filter(existsFile);

const publicSymbols = new Set<string>();
for (const entry of ENTRIES) collectExports(entry, publicSymbols);

const docPages = new Set<string>();
try {
  for (const name of readdirSync(API_DOCS_DIR)) {
    if (name.endsWith(".md") && name !== "README.md" && name !== "index.md") {
      docPages.add(name.slice(0, -3));
    }
  }
} catch {
  /* docs/api/ may not exist yet */
}

const missing = [...publicSymbols].filter((s) => !docPages.has(s));
const extra = [...docPages].filter((p) => !publicSymbols.has(p));

if (missing.length === 0 && extra.length === 0) {
  console.log(`✓ docs/api/ in sync (${publicSymbols.size} symbols)`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error(`✗ public API symbols without docs/api/*.md (${missing.length}):`);
  for (const s of missing.sort()) console.error(`    + ${s}`);
}
if (extra.length > 0) {
  console.error(`✗ docs/api/*.md pages with no matching export (${extra.length}):`);
  for (const s of extra.sort()) console.error(`    - ${s}`);
}
console.error(`\n  public entries: ${ENTRIES.map((f) => relative(ROOT, f)).join(", ")}`);
process.exit(1);

function existsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function collectExports(file: string, out: Set<string>): void {
  const src = readFileSync(file, "utf8");
  const declRe =
    /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(declRe)) out.add(m[1] ?? "");
  const listRe = /^\s*export\s*\{([^}]*)\}/gm;
  for (const m of src.matchAll(listRe)) {
    for (const raw of (m[1] ?? "").split(",")) {
      const part = raw.replace(/^\s*type\s+/, "").trim();
      const mm = part.match(/(?:[A-Za-z_$][\w$]*\s+as\s+)?([A-Za-z_$][\w$]*)$/);
      if (mm?.[1]) out.add(mm[1]);
    }
  }
}
