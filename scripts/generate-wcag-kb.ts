#!/usr/bin/env bun
/**
 * Generates docs/kb/wcag/<sc>.md — one page per WCAG 2.2 success
 * criterion — from the criteria data in src/standards/wcag22/.
 *
 * These pages are agent-retrieval-optimized: dense, headed, linking
 * back to the W3C spec, and cross-referencing the rules that check
 * the criterion. Never hand-edit them; they get overwritten on
 * every run.
 */

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { WCAG22_CRITERIA } from "../src/standards/wcag22/criteria.ts";
import { WCAG22_URL, WCAG22_VERSION } from "../src/standards/wcag22/metadata.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const OUT_DIR = join(ROOT, "docs", "kb", "wcag");

mkdirSync(OUT_DIR, { recursive: true });

// Clear stale entries first.
for (const name of safeReaddir(OUT_DIR)) {
  if (name.endsWith(".md") && name !== "index.md" && name !== "README.md") {
    unlinkSync(join(OUT_DIR, name));
  }
}

let written = 0;
for (const c of WCAG22_CRITERIA) {
  const sc = c.id.replace(/^wcag22:/, "").replace(/\./g, "-");
  writeFileSync(join(OUT_DIR, `${sc}.md`), renderPage(c));
  written += 1;
}

console.log(`✓ generated ${written} WCAG 2.2 KB pages → ${OUT_DIR}`);

function renderPage(c: (typeof WCAG22_CRITERIA)[number]): string {
  const scId = c.id.replace(/^wcag22:/, "");
  const anchor = c.url ?? `${WCAG22_URL}#${(c.slug ?? "").toLowerCase()}`;
  const satisfying = c.satisfiedBy ?? [];
  const equiv = c.equivalentTo ?? [];

  return [
    "---",
    `title: "${c.title}"`,
    `sc: "${scId}"`,
    `level: "${c.level}"`,
    `automatable: "${c.automatable ?? "unknown"}"`,
    `standard: "WCAG ${WCAG22_VERSION}"`,
    "---",
    "",
    `# ${scId} ${c.title}`,
    "",
    `- **Level:** ${c.level}`,
    `- **Automatable:** ${c.automatable ?? "unknown"}`,
    `- **Spec:** <${anchor}>`,
    "",
    "## Normative text",
    "",
    (c.description ?? "").trim(),
    "",
    "## Rules that satisfy this criterion",
    "",
    satisfying.length > 0
      ? satisfying.map((r) => `- \`${r}\``).join("\n")
      : "_No automated rule yet — checklist / manual review only._",
    "",
    "## Equivalent criteria in other standards",
    "",
    equiv.length > 0 ? equiv.map((e) => `- ${e}`).join("\n") : "_None mapped yet._",
    "",
  ].join("\n");
}

function safeReaddir(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
