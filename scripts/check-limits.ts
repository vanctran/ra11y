#!/usr/bin/env bun
/**
 * Enforces file-size, function-size, and nesting-depth budgets across
 * src/. Complexity is already enforced by Biome's
 * noExcessiveCognitiveComplexity rule, so we don't duplicate that here.
 *
 * Budgets are chosen to match CLAUDE.md §3's "small, auditable, no magic"
 * principle:
 *
 *   - file lines      ≤  500   (excluding blank lines and comment-only lines)
 *   - function lines  ≤  120   (same counting rules)
 *   - nesting depth   ≤    5   (braces deep, excluding the function body's own brace)
 *
 * Function extraction is a light regex walk — we don't parse TypeScript.
 * It's good enough to catch "this function is too big" without
 * pulling in a real parser. Anything more rigorous belongs in a
 * linter rule, not a CI guard.
 *
 * Exits 0 on success, 1 on violation with file:line diagnostics.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");

const MAX_FILE_LINES = 500;
const MAX_FUNCTION_LINES = 120;
const MAX_NESTING_DEPTH = 5;

/**
 * Files exempted from the file-line budget. These are pure-data
 * modules where splitting would fragment a single canonical table.
 * Function-line and nesting budgets still apply — this only waives
 * the whole-file count.
 */
const DATA_FILE_EXEMPTIONS: readonly RegExp[] = [/src\/standards\/[^/]+\/criteria\.ts$/];

const violations: string[] = [];

walk(SRC_DIR);

if (violations.length > 0) {
  console.error("✗ limits guard violated:\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    `\nFix: split the file/function, or flatten the nesting. Budgets (file ${MAX_FILE_LINES}, fn ${MAX_FUNCTION_LINES}, nest ${MAX_NESTING_DEPTH}) protect readability.`,
  );
  process.exit(1);
}

console.log("✓ limits: all files pass file/function/nesting budgets");
process.exit(0);

// ---------------------------------------------------------------------------

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
    if (st.isDirectory()) {
      walk(full);
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      check(full);
    }
  }
}

function check(file: string): void {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const effective = countEffectiveLines(lines);
  const rel = relative(ROOT, file);

  const exemptFile = DATA_FILE_EXEMPTIONS.some((re) => re.test(rel));
  if (!exemptFile && effective > MAX_FILE_LINES) {
    violations.push(`${rel}: file has ${effective} effective lines (max ${MAX_FILE_LINES})`);
  }

  for (const fn of extractFunctions(lines)) {
    const fnEffective = countEffectiveLines(lines.slice(fn.startLine - 1, fn.endLine));
    if (fnEffective > MAX_FUNCTION_LINES) {
      violations.push(
        `${rel}:${fn.startLine}: function '${fn.name}' has ${fnEffective} effective lines (max ${MAX_FUNCTION_LINES})`,
      );
    }
    if (fn.maxDepth > MAX_NESTING_DEPTH) {
      violations.push(
        `${rel}:${fn.startLine}: function '${fn.name}' nests ${fn.maxDepth} levels deep (max ${MAX_NESTING_DEPTH})`,
      );
    }
  }
}

/** Counts non-blank, non-comment-only lines. */
function countEffectiveLines(lines: readonly string[]): number {
  const state = { inBlockComment: false };
  let count = 0;
  for (const raw of lines) {
    if (isCodeLine(raw.trim(), state)) count += 1;
  }
  return count;
}

function isCodeLine(line: string, state: { inBlockComment: boolean }): boolean {
  if (state.inBlockComment) {
    if (line.includes("*/")) state.inBlockComment = false;
    return false;
  }
  if (line.length === 0) return false;
  if (line.startsWith("//")) return false;
  if (line.startsWith("*")) return false;
  if (line.startsWith("/*")) {
    if (!line.includes("*/")) state.inBlockComment = true;
    return false;
  }
  return true;
}

interface FunctionSpan {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly maxDepth: number;
}

/**
 * Extracts top-level function-like spans. Recognizes:
 *   - `function name(...) { ... }`
 *   - `export function name(...) { ... }`
 *   - `function* name(...) { ... }`
 *   - methods inside classes (`  foo(args) { ... }`)
 *
 * Arrow-function const declarations aren't tracked — they rarely
 * exceed the budget in practice, and extracting them reliably
 * needs a real parser.
 */
function extractFunctions(lines: readonly string[]): readonly FunctionSpan[] {
  const out: FunctionSpan[] = [];
  const fnRe =
    /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = fnRe.exec(line);
    if (!match) continue;
    const name = match[1] ?? "<anonymous>";
    const span = scanBody(lines, i);
    if (span) {
      out.push({ name, startLine: i + 1, endLine: span.endLine, maxDepth: span.maxDepth });
    }
  }
  return out;
}

interface StripState {
  str: string | null;
  block: boolean;
}

/**
 * Given a line index that introduced a function, scans forward through
 * the body tracking brace depth. Strings and comments are stripped per
 * line via `stripLineCode` so the scan itself is a trivial brace
 * counter. Returns the end line (the line with the matching close
 * brace) and the max depth reached relative to the function body.
 */
function scanBody(
  lines: readonly string[],
  startIdx: number,
): { readonly endLine: number; readonly maxDepth: number } | null {
  const state: StripState = { str: null, block: false };
  const counter: BraceCounter = { depth: 0, maxDepth: 0, started: false };
  for (let i = startIdx; i < lines.length; i += 1) {
    const clean = stripLineCode(lines[i] ?? "", state);
    if (applyBraces(clean, counter)) return { endLine: i + 1, maxDepth: counter.maxDepth };
  }
  return null;
}

interface BraceCounter {
  depth: number;
  maxDepth: number;
  started: boolean;
}

/** Updates the brace counter for a stripped line; returns true when the body closes. */
function applyBraces(clean: string, counter: BraceCounter): boolean {
  for (const c of clean) {
    if (c === "{") {
      counter.depth += 1;
      counter.started = true;
      if (counter.depth - 1 > counter.maxDepth) counter.maxDepth = counter.depth - 1;
      continue;
    }
    if (c === "}") {
      counter.depth -= 1;
      if (counter.started && counter.depth === 0) return true;
    }
  }
  return false;
}

/**
 * Returns the given line with strings, line comments, and block
 * comments stripped away. Updates `state` so multi-line strings and
 * multi-line block comments carry across calls.
 */
function stripLineCode(line: string, state: StripState): string {
  let out = "";
  let j = 0;
  while (j < line.length) {
    if (state.block) {
      j = skipBlockComment(line, j, state);
      continue;
    }
    if (state.str !== null) {
      j = skipString(line, j, state);
      continue;
    }
    const next = advanceCode(line, j, state);
    if (next.stop) break;
    if (next.keep !== null) out += next.keep;
    j = next.next;
  }
  return out;
}

interface CodeStep {
  readonly next: number;
  readonly keep: string | null;
  readonly stop: boolean;
}

/** Walks one character of non-string, non-block-comment code. */
function advanceCode(line: string, j: number, state: StripState): CodeStep {
  const c = line[j] ?? "";
  const next = line[j + 1] ?? "";
  if (c === "/" && next === "/") return { next: line.length, keep: null, stop: true };
  if (c === "/" && next === "*") {
    state.block = true;
    return { next: j + 2, keep: null, stop: false };
  }
  if (c === '"' || c === "'" || c === "`") {
    state.str = c;
    return { next: j + 1, keep: null, stop: false };
  }
  return { next: j + 1, keep: c, stop: false };
}

function skipBlockComment(line: string, start: number, state: StripState): number {
  const end = line.indexOf("*/", start);
  if (end === -1) return line.length;
  state.block = false;
  return end + 2;
}

function skipString(line: string, start: number, state: StripState): number {
  const quote = state.str;
  let j = start;
  while (j < line.length) {
    const c = line[j] ?? "";
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === quote) {
      state.str = null;
      return j + 1;
    }
    j += 1;
  }
  return j;
}
