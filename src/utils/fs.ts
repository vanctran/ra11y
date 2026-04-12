/**
 * Filesystem helpers. We intentionally use Node's `node:fs/promises` rather
 * than `Bun.file()` so the shipped artifact runs on Node LTS without the
 * Bun runtime.
 */

import type { Dirent } from "node:fs";
import { readFile as nodeReadFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Reads a UTF-8 file. Returns the contents or null if the file doesn't exist. */
export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await nodeReadFile(filePath, "utf8");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** True if the given path exists and is a regular file. */
export async function isFile(filePath: string): Promise<boolean> {
  try {
    const st = await stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

/** True if the given path exists and is a directory. */
export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const st = await stat(filePath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** Recursively lists every file under `root` that matches the filter. */
export async function walkFiles(
  root: string,
  filter: (filePath: string) => boolean,
  ignore: ReadonlySet<string>,
): Promise<string[]> {
  const out: string[] = [];
  await walk(root, out, filter, ignore);
  return out;
}

async function walk(
  dir: string,
  out: string[],
  filter: (filePath: string) => boolean,
  ignore: ReadonlySet<string>,
): Promise<void> {
  // `readdir(..., { withFileTypes: true })` returns Dirent<string>[]; the
  // generic Awaited<ReturnType<typeof readdir>> picks up the default buffer
  // overload, which has the wrong element type. Name the shape explicitly.
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out, filter, ignore);
    } else if (entry.isFile() && filter(full)) {
      out.push(full);
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

/**
 * Default directories the scanner skips even without a .gitignore.
 *
 * Includes JS/TS build artifacts, Python virtualenvs and coverage output,
 * and common tool caches. `htmlcov/` matters specifically because Python
 * coverage generates hundreds of large auto-generated HTML files that
 * would otherwise be scanned — not source code a user wants flagged.
 */
export const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set([
  // JS/TS build artifacts
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  // VCS / tooling
  ".git",
  // Coverage reports (JS + Python)
  "coverage",
  "htmlcov",
  ".nyc_output",
  // Python
  "__pycache__",
  "venv",
  ".venv",
  "site-packages",
  ".tox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  // Rust / Go
  "target",
  "vendor",
]);
