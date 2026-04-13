#!/usr/bin/env bun
/**
 * Validates relative markdown links across docs/:
 *   - [text](./foo.md) → must resolve to an existing file
 *   - [text](../bar/baz.md#anchor) → the file part must exist; the
 *     anchor is not verified (markdown slugification is ambiguous).
 *
 * External links (http://, https://, mailto:) are ignored — that's
 * check-docs-links's scope, not connectivity.
 *
 * Exits 0 if clean, 1 on dead links.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const DOCS_DIR = join(ROOT, "docs");

const violations: string[] = [];
walk(DOCS_DIR);

if (violations.length > 0) {
  console.error(`✗ dead links in docs/ (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("✓ docs links resolve");
process.exit(0);

function walk(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith(".md")) scan(full);
  }
}

function scan(file: string): void {
  const src = readFileSync(file, "utf8");
  const linkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const dir = dirname(file);
  for (const m of src.matchAll(linkRe)) {
    const target = m[2] ?? "";
    if (isExternal(target)) continue;
    const [pathPart] = target.split("#");
    if (!pathPart) continue;
    const resolved = resolve(dir, pathPart);
    if (!exists(resolved)) {
      const lineNo = src.slice(0, m.index ?? 0).split("\n").length;
      violations.push(`${relative(ROOT, file)}:${lineNo}  dead link: ${target}`);
    }
  }
}

function isExternal(t: string): boolean {
  return /^(?:https?:|mailto:|tel:|#)/.test(t);
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
