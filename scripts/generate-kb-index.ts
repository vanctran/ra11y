#!/usr/bin/env bun
/**
 * Generates docs/kb/index.md — a flat agent-retrieval-friendly
 * index of every knowledge-base entry. We separate the index from
 * the generators so any of the three (rules, wcag, standards) can
 * be regenerated independently and this script stitches the result.
 *
 * The index lists every *.md under docs/kb/, grouped by subfolder.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const KB_DIR = join(ROOT, "docs", "kb");
const OUT = join(KB_DIR, "index.md");

const groups = new Map<string, { slug: string; title: string; path: string }[]>();

walk(KB_DIR, KB_DIR);

const order = ["wcag", "rules", "standards", "architecture", "patterns", "concepts", "gotchas"];
const sortedKeys = [...groups.keys()].sort(
  (a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b),
);

const lines: string[] = [
  "# ra11y knowledge base",
  "",
  "Generated — do not edit. Regenerate via `bun scripts/generate-kb-index.ts`.",
  "",
];

for (const key of sortedKeys) {
  const entries = (groups.get(key) ?? []).sort((a, b) => a.slug.localeCompare(b.slug));
  if (entries.length === 0) continue;
  lines.push(`## ${key}`, "");
  for (const e of entries) lines.push(`- [${e.title}](${e.path})`);
  lines.push("");
}

writeFileSync(OUT, lines.join("\n"));
console.log(`✓ generated KB index (${total(groups)} entries) → ${relative(ROOT, OUT)}`);

function walk(dir: string, rootDir: string): void {
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
      walk(full, rootDir);
    } else if (name.endsWith(".md") && name !== "index.md" && name !== "README.md") {
      addEntry(full, rootDir);
    }
  }
}

function addEntry(file: string, rootDir: string): void {
  const rel = relative(rootDir, file);
  const group = rel.split("/")[0] ?? "misc";
  const slug = rel.replace(/\.md$/, "");
  const title = readTitle(file) ?? slug;
  const list = groups.get(group) ?? [];
  list.push({ slug, title, path: `./${rel}` });
  groups.set(group, list);
}

function readTitle(file: string): string | null {
  const src = readFileSync(file, "utf8");
  const fm = src.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const t = fm[1]?.match(/^title:\s*"?([^"\n]+)"?/m);
    if (t?.[1]) return t[1].trim();
  }
  const h = src.match(/^#\s+(.+)$/m);
  return h?.[1]?.trim() ?? null;
}

function orderIndex(key: string): number {
  const idx = order.indexOf(key);
  return idx >= 0 ? idx : order.length;
}

function total(m: Map<string, { slug: string }[]>): number {
  let n = 0;
  for (const v of m.values()) n += v.length;
  return n;
}
