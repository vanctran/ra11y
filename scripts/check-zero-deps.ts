#!/usr/bin/env bun
/**
 * Enforces the zero-runtime-dependency invariant.
 *
 * ra11y's dependency story is the whole product: no transitive downloads,
 * no supply-chain surface, no install weight. This script fails the build
 * if anything drifts.
 *
 * Checks:
 *   1. package.json.dependencies is empty or absent
 *   2. package.json.peerDependencies is exactly { typescript: string } with optional metadata
 *   3. package.json.devDependencies is limited to the allow-list
 *   4. Nothing in src/ imports from a non-relative, non-node-builtin, non-typescript module
 *
 * Exits 0 on success, 1 on violation with a clear diagnostic.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const PKG_PATH = join(ROOT, "package.json");

const ALLOWED_DEV_DEPS = new Set([
  "typescript",
  "@types/node",
  "@types/bun",
  "@biomejs/biome",
  "typedoc",
  "@mermaid-js/mermaid-cli",
  "markdownlint-cli2",
  "lychee",
]);

const violations: string[] = [];

// 1. package.json checks
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const runtimeDeps = pkg.dependencies ?? {};
const runtimeDepCount = Object.keys(runtimeDeps).length;
if (runtimeDepCount > 0) {
  violations.push(
    `package.json.dependencies has ${runtimeDepCount} entries: ${Object.keys(runtimeDeps).join(", ")}. Must be {}.`,
  );
}

const peerDeps = pkg.peerDependencies ?? {};
for (const name of Object.keys(peerDeps)) {
  if (name !== "typescript") {
    violations.push(
      `package.json.peerDependencies has unexpected entry '${name}'. Only 'typescript' is allowed.`,
    );
  }
}

const devDeps = pkg.devDependencies ?? {};
for (const name of Object.keys(devDeps)) {
  if (!ALLOWED_DEV_DEPS.has(name)) {
    violations.push(
      `package.json.devDependencies has non-allow-listed entry '${name}'. Allow-list: ${[...ALLOWED_DEV_DEPS].join(", ")}. If this is intentional, add it to ALLOWED_DEV_DEPS in scripts/check-zero-deps.ts with a comment explaining why.`,
    );
  }
}

// 2. src/ import checks
const SRC_DIR = join(ROOT, "src");
walkSrc(SRC_DIR);

function walkSrc(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // src/ may not exist yet in early phases
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkSrc(full);
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      checkFileImports(full);
    }
  }
}

function checkFileImports(file: string): void {
  const content = readFileSync(file, "utf8");
  const importRe = /^\s*(?:import[\s\S]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["'])/gm;
  for (const match of content.matchAll(importRe)) {
    const spec = match[1] ?? match[2] ?? "";
    if (!spec) continue;
    if (isLocal(spec)) continue;
    if (spec.startsWith("node:")) continue;
    if (spec === "typescript" || spec.startsWith("typescript/")) continue;
    violations.push(`${relative(ROOT, file)}: imports '${spec}' — only node: builtins, typescript, and relative paths are allowed in src/.`);
  }
}

function isLocal(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("@/");
}

if (violations.length > 0) {
  console.error("✗ zero-dependency invariant violated:\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nFix: remove the offending entries and reimplement any needed helpers in src/utils/.",
  );
  process.exit(1);
}

console.log("✓ zero-dep invariant: passed");
console.log(
  `  dependencies: 0 | peerDependencies: ${Object.keys(peerDeps).length} | devDependencies: ${Object.keys(devDeps).length}`,
);
process.exit(0);
