#!/usr/bin/env bun
/**
 * Enforces no circular imports in src/.
 *
 * Builds an import graph by scanning every .ts/.tsx file under src/,
 * resolving relative imports to their absolute file paths, then runs
 * Tarjan's strongly-connected-components algorithm. Any SCC larger
 * than one node is a cycle.
 *
 * Circular imports cause several real problems:
 *   - Intermittent "X is not defined" runtime errors when ESM load
 *     order interleaves with temporal dead zones.
 *   - Harder-to-reason-about initialization: which side of the cycle
 *     sees which exports at module-eval time?
 *   - Test isolation breaks because mocking one file affects others.
 *
 * Our architecture already enforces direction (engine → registries →
 * rules; engine never imports from rules) but this script is the
 * mechanical check that catches drift.
 *
 * Exits 0 if clean, 1 if any cycle is found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const SRC_DIR = join(ROOT, "src");

const graph = new Map<string, Set<string>>();
const allFiles: string[] = [];

walk(SRC_DIR);

const cycles = findCycles(graph);

if (cycles.length > 0) {
  console.error(`✗ circular imports found (${cycles.length}):\n`);
  for (const cycle of cycles) {
    console.error(`  cycle:`);
    for (const node of cycle) console.error(`    ${relative(ROOT, node)}`);
    console.error("");
  }
  console.error(
    "Fix: break the cycle by extracting shared types into a module that both sides depend on, or by inverting one of the imports.",
  );
  process.exit(1);
}

console.log(`✓ no circular imports (${allFiles.length} files, ${edgeCount(graph)} edges)`);
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
      allFiles.push(full);
      graph.set(full, collectImports(full));
    }
  }
}

function collectImports(file: string): Set<string> {
  const source = readFileSync(file, "utf8");
  const importRe = /^\s*(?:import[\s\S]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["'])/gm;
  const dir = dirname(file);
  const out = new Set<string>();
  for (const match of source.matchAll(importRe)) {
    const spec = match[1] ?? match[2] ?? "";
    if (!(spec && isRelative(spec))) continue;
    const resolved = resolveImport(dir, spec);
    if (resolved) out.add(resolved);
  }
  return out;
}

function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/**
 * Resolves a relative import spec to an absolute file path. Tries the
 * exact path, then `.ts`, `.tsx`, `/index.ts`, `/index.tsx`. Returns
 * null if nothing matches — we silently skip unresolvable imports
 * because they're likely typos or missing files the regular build
 * would catch anyway.
 */
function resolveImport(fromDir: string, spec: string): string | null {
  const base = resolve(fromDir, spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsFile(candidate)) return candidate;
  }
  return null;
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function edgeCount(g: ReadonlyMap<string, ReadonlySet<string>>): number {
  let total = 0;
  for (const edges of g.values()) total += edges.size;
  return total;
}

/**
 * Tarjan's algorithm for strongly-connected components. Returns the
 * list of SCCs that contain a cycle (size > 1, or size 1 with a
 * self-loop).
 */
function findCycles(g: ReadonlyMap<string, ReadonlySet<string>>): readonly (readonly string[])[] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  const state = { counter: 0 };

  for (const node of g.keys()) {
    if (!index.has(node)) strongconnect(node, g, state, index, lowlink, onStack, stack, result);
  }
  return result;
}

interface TarjanCtx {
  readonly g: ReadonlyMap<string, ReadonlySet<string>>;
  readonly state: { counter: number };
  readonly index: Map<string, number>;
  readonly lowlink: Map<string, number>;
  readonly onStack: Set<string>;
  readonly stack: string[];
  readonly result: string[][];
}

function strongconnect(
  v: string,
  g: ReadonlyMap<string, ReadonlySet<string>>,
  state: { counter: number },
  index: Map<string, number>,
  lowlink: Map<string, number>,
  onStack: Set<string>,
  stack: string[],
  result: string[][],
): void {
  const ctx: TarjanCtx = { g, state, index, lowlink, onStack, stack, result };
  tarjanVisit(v, ctx);
}

function tarjanVisit(v: string, ctx: TarjanCtx): void {
  ctx.index.set(v, ctx.state.counter);
  ctx.lowlink.set(v, ctx.state.counter);
  ctx.state.counter += 1;
  ctx.stack.push(v);
  ctx.onStack.add(v);

  for (const w of ctx.g.get(v) ?? []) {
    visitEdge(v, w, ctx);
  }

  if ((ctx.lowlink.get(v) ?? 0) === (ctx.index.get(v) ?? 0)) {
    popComponent(v, ctx);
  }
}

function visitEdge(v: string, w: string, ctx: TarjanCtx): void {
  if (!ctx.index.has(w)) {
    tarjanVisit(w, ctx);
    ctx.lowlink.set(v, Math.min(ctx.lowlink.get(v) ?? 0, ctx.lowlink.get(w) ?? 0));
    return;
  }
  if (ctx.onStack.has(w)) {
    ctx.lowlink.set(v, Math.min(ctx.lowlink.get(v) ?? 0, ctx.index.get(w) ?? 0));
  }
}

function popComponent(v: string, ctx: TarjanCtx): void {
  const component: string[] = [];
  for (;;) {
    const w = ctx.stack.pop();
    if (w === undefined) break;
    ctx.onStack.delete(w);
    component.push(w);
    if (w === v) break;
  }
  if (component.length > 1 || (ctx.g.get(v)?.has(v) ?? false)) {
    ctx.result.push(component);
  }
}
