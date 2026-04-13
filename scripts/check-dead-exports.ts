#!/usr/bin/env bun
/**
 * Finds exports in src/ that no other file imports.
 *
 * Dead exports accumulate as the codebase evolves: a helper gets
 * inlined, a type gets replaced, a barrel re-exports a symbol that
 * nobody consumes. They are harmless individually but corrode the
 * public API over time — external consumers assume anything exported
 * is fair game, so we need to keep the surface honest.
 *
 * Algorithm:
 *   1. Collect every named export from every src/ file.
 *   2. Parse imports and `export ... from` re-exports across src/,
 *      tests/, and scripts/. Resolve relative specifiers to absolute
 *      paths the same way check-cycles does.
 *   3. Mark a (file, symbol) pair as used if any other file imports
 *      that symbol from that file, re-exports it, or does `import *`
 *      / `export *` against that file.
 *   4. Seed the used set with every export of the package's public
 *      entry files — those are consumed by external callers we can't
 *      see from inside the repo.
 *   5. Report anything left unused.
 *
 * The analysis is regex-based and intentionally conservative. False
 * positives (something we flag as dead but is actually used by a
 * pattern we don't parse) are worse than false negatives, so when in
 * doubt we treat a symbol as used.
 *
 * Exits 0 if clean, 1 if any dead export is found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");
const TESTS_DIR = join(ROOT, "tests");
const SCRIPTS_DIR = join(ROOT, "scripts");

const PUBLIC_ENTRIES = [
  join(SRC_DIR, "index.ts"),
  join(SRC_DIR, "cli.ts"),
  join(SRC_DIR, "api", "index.ts"),
  join(SRC_DIR, "api", "plugin.ts"),
].filter(existsFile);

const STAR_MARKER = "*";
const DEFAULT_MARKER = "default";

interface ExportRecord {
  readonly file: string;
  readonly name: string;
}

const exportsByFile = new Map<string, Set<string>>();
const usedByFile = new Map<string, Set<string>>();

const srcFiles = walkTs(SRC_DIR);
for (const file of srcFiles) {
  exportsByFile.set(file, collectExports(file));
}

const consumerFiles = [...srcFiles, ...walkTs(TESTS_DIR), ...walkTs(SCRIPTS_DIR)];
for (const file of consumerFiles) {
  recordImports(file);
}

for (const entry of PUBLIC_ENTRIES) {
  markAll(entry);
}

const dead: ExportRecord[] = [];
for (const [file, names] of exportsByFile) {
  const used = usedByFile.get(file);
  const wildcard = used?.has(STAR_MARKER) ?? false;
  if (wildcard) continue;
  for (const name of names) {
    if (!used?.has(name)) {
      dead.push({ file, name });
    }
  }
}

if (dead.length > 0) {
  console.error(`✗ dead exports (${dead.length}):\n`);
  const grouped = new Map<string, string[]>();
  for (const { file, name } of dead) {
    const key = relative(ROOT, file);
    const list = grouped.get(key) ?? [];
    list.push(name);
    grouped.set(key, list);
  }
  const keys = [...grouped.keys()].sort();
  for (const key of keys) {
    const names = (grouped.get(key) ?? []).sort();
    console.error(`  ${key}`);
    for (const name of names) console.error(`    - ${name}`);
  }
  console.error(
    "\nFix: delete the export, or import it where it's actually needed. If it is part of the public API, add its entry file to PUBLIC_ENTRIES in this script.",
  );
  process.exit(1);
}

const totalExports = [...exportsByFile.values()].reduce((sum, s) => sum + s.size, 0);
console.log(`✓ no dead exports (${totalExports} symbols across ${exportsByFile.size} files)`);
process.exit(0);

// ---------------------------------------------------------------------------

function walkTs(dir: string): string[] {
  const out: string[] = [];
  walk(dir, out);
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function collectExports(file: string): Set<string> {
  const src = stripComments(readFileSync(file, "utf8"));
  const names = new Set<string>();

  // export const/let/var/function/class/interface/type/enum NAME
  const declRe =
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of src.matchAll(declRe)) names.add(m[1] ?? "");

  // export { A, B as C } (no `from` → local rebind, introduces A and C as exports)
  const localListRe = /\bexport\s*\{([^}]*)\}\s*(?!from)/g;
  for (const m of src.matchAll(localListRe)) {
    for (const spec of splitList(m[1] ?? "")) {
      names.add(spec.exported);
    }
  }

  // export { A, B as C } from "..."  (re-export; introduces exported names)
  const reListRe = /\bexport\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;
  for (const m of src.matchAll(reListRe)) {
    for (const spec of splitList(m[1] ?? "")) {
      names.add(spec.exported);
    }
  }

  // export default ...
  if (/\bexport\s+default\b/.test(src)) names.add(DEFAULT_MARKER);

  // export * as NS from "..." introduces NS
  const starAsRe = /\bexport\s*\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g;
  for (const m of src.matchAll(starAsRe)) names.add(m[1] ?? "");

  names.delete("");
  return names;
}

/**
 * Records every import and re-export in `file` as a use against the
 * resolved target. `export { X } from "./y"` counts both as a local
 * export in `file` (handled by collectExports) and as a use of X in y.
 */
function recordImports(file: string): void {
  const src = stripComments(readFileSync(file, "utf8"));
  const dir = dirname(file);
  recordImportStatements(src, dir);
  recordReExportLists(src, dir);
  recordStarReExports(src, dir);
}

function recordImportStatements(src: string, dir: string): void {
  const importRe =
    /\bimport\s+(?:type\s+)?([\s\S]*?)from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(importRe)) {
    const spec = m[2] ?? m[3] ?? "";
    const target = resolveIfRelative(dir, spec);
    if (!target) continue;
    const clause = (m[1] ?? "").trim();
    if (!clause) continue;
    markClause(target, clause);
  }
}

function recordReExportLists(src: string, dir: string): void {
  const reListRe = /\bexport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(reListRe)) {
    const target = resolveIfRelative(dir, m[2] ?? "");
    if (!target) continue;
    for (const s of splitList(m[1] ?? "")) mark(target, s.local);
  }
}

function recordStarReExports(src: string, dir: string): void {
  const starReRe = /\bexport\s*\*(?:\s+as\s+[A-Za-z_$][\w$]*)?\s+from\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(starReRe)) {
    const target = resolveIfRelative(dir, m[1] ?? "");
    if (target) markAll(target);
  }
}

function resolveIfRelative(fromDir: string, spec: string): string | null {
  if (!isRelative(spec)) return null;
  return resolveImport(fromDir, spec);
}

function markClause(target: string, clause: string): void {
  // Trim trailing type-only marker and leading `type`
  const trimmed = clause.replace(/^type\s+/, "").trim();

  // import * as NS
  const starMatch = trimmed.match(/^\*\s+as\s+[A-Za-z_$][\w$]*/);
  if (starMatch) {
    markAll(target);
    return;
  }

  // Split default and named parts: "Default, { a, b as c }" or just one.
  const braceMatch = trimmed.match(/\{([^}]*)\}/);
  const before = braceMatch ? trimmed.slice(0, braceMatch.index).trim() : trimmed.trim();
  const defaultName = before.replace(/,$/, "").trim();
  if (defaultName && !defaultName.startsWith("{") && !defaultName.startsWith("*")) {
    mark(target, DEFAULT_MARKER);
  }
  if (braceMatch) {
    for (const s of splitList(braceMatch[1] ?? "")) mark(target, s.local);
  }
}

function mark(target: string, name: string): void {
  if (!name) return;
  const set = usedByFile.get(target) ?? new Set<string>();
  set.add(name);
  usedByFile.set(target, set);
}

function markAll(target: string): void {
  mark(target, STAR_MARKER);
}

interface ImportSpec {
  readonly local: string;
  readonly exported: string;
}

/**
 * Splits the body of a `{ ... }` import/export list into records. For
 * `{ a, b as c }`, yields `{ local: "a", exported: "a" }` and
 * `{ local: "b", exported: "c" }`. `local` is the name as it exists
 * in the target module; `exported` is the name introduced locally.
 */
function splitList(body: string): ImportSpec[] {
  const out: ImportSpec[] = [];
  for (const rawPart of body.split(",")) {
    const part = rawPart.replace(/^\s*type\s+/, "").trim();
    if (!part) continue;
    const asMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (asMatch) {
      out.push({ local: asMatch[1] ?? "", exported: asMatch[2] ?? "" });
      continue;
    }
    const nameMatch = part.match(/^([A-Za-z_$][\w$]*)$/);
    if (nameMatch) {
      const name = nameMatch[1] ?? "";
      out.push({ local: name, exported: name });
    }
  }
  return out;
}

function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

function resolveImport(fromDir: string, spec: string): string | null {
  const base = resolve(fromDir, spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsFile(c)) return c;
  }
  return null;
}

/**
 * Strips // line and /* block *\/ comments. Keeps string literals
 * intact so the import-spec regex can still see paths inside quotes.
 * False positives from `import` keywords inside template literals or
 * example strings inside JSDoc are rare in this codebase and we
 * accept them — this check is conservative.
 */
function stripComments(src: string): string {
  // Block comments first (multi-line), then line comments.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
