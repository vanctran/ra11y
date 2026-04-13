#!/usr/bin/env bun
/**
 * Enforces TSDoc on every exported symbol in the public API surface:
 * src/index.ts, src/cli.ts, and everything under src/api/. Internal
 * modules are not required to have TSDoc — this check is only about
 * what external consumers of `@ra11y/core` and `@ra11y/core/plugin`
 * see when they hover a symbol.
 *
 * A symbol is considered documented if the line immediately above
 * its `export` declaration ends with `*\/` (i.e. closes a JSDoc
 * block comment).
 *
 * Exits 0 if clean, 1 on violations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");

const PUBLIC_FILES: string[] = [];
maybeAdd(join(SRC_DIR, "index.ts"));
maybeAdd(join(SRC_DIR, "cli.ts"));
walkInto(join(SRC_DIR, "api"), PUBLIC_FILES);

const violations: string[] = [];
for (const file of PUBLIC_FILES) checkFile(file);

if (violations.length > 0) {
  console.error(`✗ missing TSDoc on public API (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nFix: add a /** ... */ block above the export.");
  process.exit(1);
}

console.log(`✓ every public export has TSDoc (${PUBLIC_FILES.length} files)`);
process.exit(0);

function maybeAdd(path: string): void {
  try {
    if (statSync(path).isFile()) PUBLIC_FILES.push(path);
  } catch {
    /* optional */
  }
}

function walkInto(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkInto(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
}

function checkFile(file: string): void {
  const lines = readFileSync(file, "utf8").split("\n");
  const exportRe =
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:declare\s+)?(const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(exportRe);
    if (!m) continue;
    if (hasTsdocAbove(lines, i)) continue;
    const rel = relative(ROOT, file);
    violations.push(`${rel}:${i + 1}  missing TSDoc on exported ${m[1]} ${m[2]}`);
  }
}

function hasTsdocAbove(lines: readonly string[], idx: number): boolean {
  for (let j = idx - 1; j >= 0; j--) {
    const t = (lines[j] ?? "").trim();
    if (!t) continue;
    if (t.startsWith("//")) continue;
    return t.endsWith("*/");
  }
  return false;
}
