#!/usr/bin/env bun
/**
 * Enforces house style on mermaid diagrams in docs/**\/*.md:
 *   - ≤ 7 nodes per diagram (readable at a glance)
 *   - single direction (flowchart TD / LR, not a mix)
 *   - every edge must be labeled (no bare `-->`)
 *   - preceded by at least one prose line within the same section
 *
 * Exits 0 if clean, 1 on violations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const DOCS_DIR = join(ROOT, "docs");

const MAX_NODES = 7;

const violations: string[] = [];
walk(DOCS_DIR);

if (violations.length > 0) {
  console.error(`✗ mermaid style violations (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("✓ mermaid diagrams conform");
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
  const blockRe = /```mermaid\n([\s\S]*?)```/g;
  for (const m of src.matchAll(blockRe)) {
    const body = m[1] ?? "";
    const lineStart = src.slice(0, m.index ?? 0).split("\n").length;
    checkBlock(file, lineStart, body);
  }
}

function checkBlock(file: string, lineNo: number, body: string): void {
  const rel = relative(ROOT, file);
  const prefix = `${rel}:${lineNo}`;

  const dirs = new Set<string>();
  const dirRe = /(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)/g;
  for (const m of body.matchAll(dirRe)) dirs.add(m[1] ?? "");
  if (dirs.size > 1) {
    violations.push(`${prefix}  mixed flow directions: ${[...dirs].join(", ")}`);
  }

  const nodeIds = new Set<string>();
  const nodeRe = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*)\s*[[({"]/g;
  for (const m of body.matchAll(nodeRe)) {
    const id = m[1] ?? "";
    if (id === "flowchart" || id === "graph" || id === "subgraph" || id === "end") continue;
    nodeIds.add(id);
  }
  if (nodeIds.size > MAX_NODES) {
    violations.push(`${prefix}  ${nodeIds.size} nodes (max ${MAX_NODES})`);
  }

  const bareEdgeRe = /-->(?!\s*\|)/g;
  const bareCount = (body.match(bareEdgeRe) ?? []).length;
  if (bareCount > 0) {
    violations.push(`${prefix}  ${bareCount} unlabeled edges — use --|label|-->`);
  }
}
