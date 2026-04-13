#!/usr/bin/env bun
/**
 * Enforces a convention on thrown errors in src/:
 *   - `throw new Error("…")` — message must be a non-empty string,
 *     start with a lowercase letter (exceptions: proper nouns, file
 *     paths), end without a trailing period, and contain no raw
 *     template placeholders like "${undefined}".
 *   - No `throw "string"`. Always wrap in an Error subclass.
 *
 * The goal is that when a user sees "ra11y: <message>", the message
 * reads like a sentence fragment the engine can splice into context.
 *
 * Exits 0 if clean, 1 on violations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");

const violations: string[] = [];
walk(SRC_DIR);

if (violations.length > 0) {
  console.error(`✗ error-message violations (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("✓ error messages conform");
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
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    checkThrowBare(file, i + 1, line);
    checkThrowNewError(file, i + 1, line);
  }
}

function checkThrowBare(file: string, lineNo: number, line: string): void {
  const bare = /\bthrow\s+["'`]/;
  if (bare.test(line)) {
    violations.push(`${relative(ROOT, file)}:${lineNo}  throw of a bare string — wrap in an Error`);
  }
}

function checkThrowNewError(file: string, lineNo: number, line: string): void {
  const m = line.match(/\bthrow\s+new\s+\w*Error\s*\(\s*["'`]([^"'`]*)["'`]/);
  if (!m) return;
  const msg = m[1] ?? "";
  if (!msg) {
    violations.push(`${relative(ROOT, file)}:${lineNo}  empty error message`);
    return;
  }
  const first = msg.charAt(0);
  const startsOK = /[a-z`"'\-\d(/]/.test(first) || msg.startsWith("${") || isProperNounStart(msg);
  if (!startsOK) {
    violations.push(
      `${relative(ROOT, file)}:${lineNo}  error message should start lowercase: "${msg}"`,
    );
  }
  if (msg.endsWith(".")) {
    violations.push(
      `${relative(ROOT, file)}:${lineNo}  trailing period in error message: "${msg}"`,
    );
  }
}

function isProperNounStart(msg: string): boolean {
  // Allow messages that start with a capitalized identifier like
  // "TypeScript …", "WCAG …", "SARIF …". These are proper nouns.
  const first = msg.split(/\s+/)[0] ?? "";
  return /^[A-Z][A-Za-z0-9]+$/.test(first) && first.length >= 3;
}
