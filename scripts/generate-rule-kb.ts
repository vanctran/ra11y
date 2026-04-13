#!/usr/bin/env bun
/**
 * Generates docs/kb/rules/<slug>.md — one page per built-in rule —
 * from the metadata on each Rule object.
 *
 * Slug format: `<domain>__<name>` (slashes replaced with double
 * underscore so the filename is flat). This matches check-kb-drift.
 *
 * Never hand-edit these; they get overwritten on every run.
 */

import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_RULES } from "../src/rules/index.ts";
import { BUILTIN_STANDARDS } from "../src/standards/index.ts";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const OUT_DIR = join(ROOT, "docs", "kb", "rules");
const STANDARDS_DIR = join(ROOT, "docs", "kb", "standards");

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(STANDARDS_DIR, { recursive: true });

for (const name of safeReaddir(STANDARDS_DIR)) {
  if (name.endsWith(".md") && name !== "index.md" && name !== "README.md") {
    unlinkSync(join(STANDARDS_DIR, name));
  }
}

for (const standard of BUILTIN_STANDARDS) {
  writeFileSync(join(STANDARDS_DIR, `${standard.id}.md`), renderStandardPage(standard));
}

for (const name of safeReaddir(OUT_DIR)) {
  if (name.endsWith(".md") && name !== "index.md" && name !== "README.md") {
    unlinkSync(join(OUT_DIR, name));
  }
}

let written = 0;
for (const rule of BUILTIN_RULES) {
  const slug = rule.id.replace(/\//g, "__");
  writeFileSync(join(OUT_DIR, `${slug}.md`), renderPage(rule));
  written += 1;
}

console.log(`✓ generated ${written} rule KB pages → ${OUT_DIR}`);

function renderPage(rule: (typeof BUILTIN_RULES)[number]): string {
  const docs = rule.docs ?? {};
  const references = docs.references ?? [];

  return [
    "---",
    `title: "${rule.id}"`,
    `severity: "${rule.severity}"`,
    `scope: "${rule.scope}"`,
    `satisfies: [${rule.satisfies.map((s) => `"${s}"`).join(", ")}]`,
    "---",
    "",
    `# \`${rule.id}\``,
    "",
    `- **Severity:** ${rule.severity}`,
    `- **Scope:** ${rule.scope}`,
    `- **Satisfies:** ${rule.satisfies.map((s) => `\`${s}\``).join(", ")}`,
    rule.appliesTo?.fileExtensions
      ? `- **Applies to:** ${rule.appliesTo.fileExtensions.join(", ")}`
      : "",
    "",
    "## What it checks",
    "",
    (docs.description ?? "_No description provided._").trim(),
    "",
    "## Why it matters",
    "",
    (docs.rationale ?? "_No rationale provided._").trim(),
    "",
    "## Normative quote",
    "",
    docs.normativeQuote ? `> ${docs.normativeQuote}` : "_(not quoted)_",
    "",
    "## Good example",
    "",
    docs.goodExample ? codeBlock(docs.goodExample) : "_(none)_",
    "",
    "## Bad example",
    "",
    docs.badExample ? codeBlock(docs.badExample) : "_(none)_",
    "",
    "## References",
    "",
    references.length > 0 ? references.map((r) => `- <${r}>`).join("\n") : "_(none)_",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .concat("\n");
}

function codeBlock(src: string): string {
  const fence = "```";
  return `${fence}tsx\n${src.trim()}\n${fence}`;
}

function renderStandardPage(s: (typeof BUILTIN_STANDARDS)[number]): string {
  const levels = (s.levels ?? []).join(", ");
  const count = s.criteria.length;
  const byLevel = new Map<string, number>();
  for (const c of s.criteria) byLevel.set(c.level, (byLevel.get(c.level) ?? 0) + 1);
  const breakdown = [...byLevel.entries()]
    .sort()
    .map(([l, n]) => `${l}: ${n}`)
    .join(" · ");

  return [
    "---",
    `title: "${s.name}"`,
    `id: "${s.id}"`,
    `version: "${s.version}"`,
    "---",
    "",
    `# ${s.name}`,
    "",
    `- **ID:** \`${s.id}\``,
    `- **Version:** ${s.version}`,
    `- **Publisher:** ${s.publisher ?? "unspecified"}`,
    `- **Levels:** ${levels}`,
    `- **Criteria:** ${count} (${breakdown})`,
    s.url ? `- **Spec:** <${s.url}>` : "",
    "",
    "## Criteria",
    "",
    s.criteria.map((c) => `- \`${c.id}\` · ${c.level} · ${c.title}`).join("\n"),
    "",
  ]
    .filter((l) => l !== "")
    .join("\n")
    .concat("\n");
}

function safeReaddir(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
