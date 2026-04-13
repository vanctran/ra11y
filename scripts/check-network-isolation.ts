#!/usr/bin/env bun
/**
 * Enforces network isolation: nothing in src/ may reference fetch/http/dns.
 *
 * ra11y is a local, offline-first tool. Users running it against proprietary
 * source must be able to trust that nothing leaves the machine. This script
 * greps src/ for network-adjacent symbols and fails the build on any hit.
 *
 * LLM-assisted workflows go through MCP sampling instead — the server
 * delegates to the host (Claude Code, Cursor, …) which owns the model
 * and the key. That keeps src/ fully offline and removes the need for a
 * carve-out. See docs/kb/architecture/mcp-server.md.
 *
 * Exits 0 on success, 1 on violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");

// Patterns we consider network-adjacent. Each entry is a regex + a human
// description. Add to this list when a new network primitive appears.
const BANNED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bfetch\s*\(/, reason: "fetch() call" },
  { pattern: /\bBun\.fetch\s*\(/, reason: "Bun.fetch() call" },
  { pattern: /from\s+["']node:http["']/, reason: "node:http import" },
  { pattern: /from\s+["']node:https["']/, reason: "node:https import" },
  { pattern: /from\s+["']node:net["']/, reason: "node:net import" },
  { pattern: /from\s+["']node:dns["']/, reason: "node:dns import" },
  { pattern: /from\s+["']node:tls["']/, reason: "node:tls import" },
  { pattern: /from\s+["']node:dgram["']/, reason: "node:dgram import" },
  { pattern: /require\(\s*["']node:http["']\s*\)/, reason: "node:http require" },
  { pattern: /require\(\s*["']node:https["']\s*\)/, reason: "node:https require" },
  { pattern: /new\s+WebSocket\b/, reason: "WebSocket constructor" },
  { pattern: /new\s+XMLHttpRequest\b/, reason: "XMLHttpRequest constructor" },
];

const violations: Array<{ file: string; line: number; reason: string; text: string }> = [];

walk(SRC_DIR);

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
      scan(full);
    }
  }
}

function scan(file: string): void {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const { pattern, reason } of BANNED_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          reason,
          text: line.trim(),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("✗ network isolation violated — src/ must not reach the network:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.reason}]`);
    console.error(`    ${v.text}`);
  }
  console.error(
    "\nra11y is offline by contract (see SECURITY.md). Move network code to scripts/, .claude/hooks/, or tests/.",
  );
  process.exit(1);
}

console.log("✓ network isolation: src/ is offline");
process.exit(0);
