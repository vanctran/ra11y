#!/usr/bin/env bun
/**
 * Build script: transpile src/ → dist/ for npm publish.
 *
 * Two steps:
 *   1. Bun.build() emits ESM JavaScript for each public entry point
 *      (index, cli, api/plugin). Bun's transpiler handles TypeScript,
 *      rewrites `.ts` imports to `.js`, and bundles each entry into a
 *      single file — this is what npm consumers load at runtime.
 *   2. tsc with tsconfig.build.json emits type declarations (.d.ts)
 *      and source maps alongside. rewriteRelativeImportExtensions
 *      rewrites `.ts` import specifiers to `.js` in the declaration
 *      output so the shipped types resolve correctly.
 *
 * The shebang on `dist/cli.js` is restored after transpile so the
 * `ra11y` bin entry stays executable on consumer machines.
 *
 * Bun-specific APIs (Bun.build) are allowed here — scripts/ is exempt
 * from the "Node-compatible only" rule that governs src/.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir ?? process.cwd(), "..");
const DIST = join(ROOT, "dist");
const SRC = join(ROOT, "src");

const start = performance.now();

// 1. Clean the output directory so stale files don't linger.
rmSync(DIST, { recursive: true, force: true });

// 2. Transpile JS via Bun.build. Each entry point becomes a single
//    ESM file plus any chunks it depends on. Target is "node" so
//    node:* imports stay intact.
const entrypoints = [join(SRC, "index.ts"), join(SRC, "cli.ts"), join(SRC, "api/plugin.ts")];

for (const entry of entrypoints) {
  if (!existsSync(entry)) {
    console.error(`✗ build: entry point missing: ${entry}`);
    process.exit(1);
  }
}

const result = await Bun.build({
  entrypoints,
  outdir: DIST,
  target: "node",
  format: "esm",
  splitting: true,
  sourcemap: "external",
  // Keep all node:* builtins and the optional typescript peer as externals.
  // Everything else in src/ is in-house and must be bundled.
  external: ["typescript"],
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("✗ build: Bun.build failed:");
  for (const log of result.logs) console.error(`  ${log.message}`);
  process.exit(1);
}

const jsFiles = result.outputs.filter((o) => o.path.endsWith(".js"));
console.log(`  transpiled ${jsFiles.length} JS artifact(s)`);

// 3. Restore the shebang on dist/cli.js so the bin entry runs.
const cliOut = join(DIST, "cli.js");
if (existsSync(cliOut)) {
  const body = readFileSync(cliOut, "utf8");
  if (!body.startsWith("#!")) {
    writeFileSync(cliOut, `#!/usr/bin/env node\n${body}`);
  }
  chmodSync(cliOut, 0o755);
}

// 4. Emit .d.ts declarations via tsc. We shell out because Bun doesn't
//    emit type declarations — it only transpiles.
const tsc = spawnSync("bunx", ["tsc", "--project", "tsconfig.build.json"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (tsc.status !== 0) {
  console.error("✗ build: tsc declaration emit failed");
  process.exit(1);
}

// 5. Sanity-check the artifacts the `exports` map promises.
const required = ["index.js", "index.d.ts", "cli.js", "api/plugin.js", "api/plugin.d.ts"];
for (const rel of required) {
  const p = join(DIST, rel);
  if (!existsSync(p)) {
    console.error(`✗ build: required artifact missing: dist/${rel}`);
    process.exit(1);
  }
}

const elapsed = Math.round(performance.now() - start);
console.log(`✓ build: dist/ ready (${elapsed}ms)`);
