#!/usr/bin/env bun
/**
 * Flags numeric literals in src/ that aren't attached to a named
 * constant. Our convention is that every non-trivial number lives
 * in a `const` declaration so the reader can see what it means.
 *
 * The allowlist covers the obvious trivial values: 0, 1, -1, 2, 10,
 * 16, 100, 1000 (powers of ten for formatting), and 0x-prefixed
 * literals (bitmasks are usually self-documenting). We also skip
 * lines that already declare a `const NAME = <number>` because that
 * IS the named constant.
 *
 * Exits 0 if clean, 1 on violations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");

const ALLOW = new Set([
  "0",
  "1",
  "-1",
  "2",
  "-2",
  "3",
  "4",
  "8",
  "10",
  "16",
  "24",
  "32",
  "64",
  "100",
  "1000",
  "255",
  "0.5",
  "0.1",
  "1.0",
  "2.0",
]);

const literalRe = /(?<![A-Za-z_$\d])(-?\d+(?:\.\d+)?)(?![A-Za-z_$\d])/g;
const declRe = /\b(?:const|let|var)\s+[A-Z_][A-Z0-9_]*\s*(?::\s*\w+\s*)?=\s*-?\d/;
const hexRe = /0x[0-9a-fA-F]+/;

const violations: string[] = [];
walk(SRC_DIR);

if (violations.length > 0) {
  console.error(`✗ magic numbers (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nFix: extract into a named `const SOMETHING = <n>` and reference that.");
  process.exit(1);
}

console.log("✓ no unnamed magic numbers");
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
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) scan(full);
  }
}

function scan(file: string): void {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isSkippable(line)) continue;
    checkLine(file, i + 1, line);
  }
}

function isSkippable(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
  if (declRe.test(line)) return true;
  if (hexRe.test(line)) return true;
  if (/enum\s+\w+/.test(line)) return true;
  if (/^\s*export\s+(?:const\s+enum|enum)\b/.test(line)) return true;
  return false;
}

function checkLine(file: string, lineNo: number, line: string): void {
  const code = stripStrings(line);
  for (const m of code.matchAll(literalRe)) {
    const n = m[1] ?? "";
    if (ALLOW.has(n)) continue;
    violations.push(`${relative(ROOT, file)}:${lineNo}  ${n}  ${line.trim()}`);
  }
}

function stripStrings(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/\/(?:\\.|\[[^\]]*\]|[^/\\])+\/[gimsuy]*/g, "//");
}
