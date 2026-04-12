/**
 * File discovery.
 *
 * Expands the set of paths given on the command line into a flat list
 * of parseable files. Applies:
 *
 *   - Default ignored directories (node_modules, dist, .git, etc.)
 *   - `.gitignore` at the repo root (when `respectGitignore !== false`)
 *   - Extension allow-list (only .tsx/.jsx/.ts/.js/.html/.htm/.css)
 *   - User exclude patterns (gitignore-style globs — see utils/glob.ts)
 *
 * Entry points:
 *   - `discoverFiles(roots, options)` takes a list of cwd-relative
 *     paths (directories or files) and returns resolved absolute
 *     file paths.
 */

import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { DEFAULT_IGNORED_DIRS, walkFiles } from "../utils/fs.ts";
import { compileGlobs, type GlobMatcher } from "../utils/glob.ts";
import { hasParseableExtension } from "../utils/path.ts";

export interface DiscoverOptions {
  /** User-supplied gitignore-style patterns. */
  readonly excludes?: readonly string[];
  /** When true, skip default test-file exclusions. */
  readonly includeTests?: boolean;
  /** When false, don't auto-load .gitignore. Default true. */
  readonly respectGitignore?: boolean;
}

/**
 * File patterns excluded by default. Test files aren't shipped UI —
 * scanning them produces noise (render assertions, mocks, etc.).
 */
const DEFAULT_EXCLUDED_PATTERNS: readonly string[] = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/__mocks__/**",
];

/** Resolves every input path into a flat list of parseable files. */
export async function discoverFiles(
  roots: readonly string[],
  options: DiscoverOptions = {},
): Promise<string[]> {
  const userExcludes = options.excludes ?? [];
  const gitignore = options.respectGitignore === false ? [] : await loadGitignoreForRoots(roots);
  const dirPatterns = buildDirExcludes(userExcludes, gitignore, options.includeTests === true);
  const dirMatcher = compileGlobs(dirPatterns);
  const userMatcher = compileGlobs([...userExcludes, ...gitignore]);
  const out = new Set<string>();

  for (const raw of roots) {
    const absRoot = resolve(raw);
    const found = await discoverOne(absRoot, userMatcher, dirMatcher);
    for (const f of found) out.add(f);
  }

  return [...out].sort();
}

/** Merges default test-file patterns with user excludes for directory walks. */
function buildDirExcludes(
  userExcludes: readonly string[],
  gitignore: readonly string[],
  includeTests: boolean,
): readonly string[] {
  const defaults = includeTests ? [] : DEFAULT_EXCLUDED_PATTERNS;
  return [...defaults, ...gitignore, ...userExcludes];
}

/**
 * Loads `.gitignore` patterns starting at each scan root and walking one
 * level into each top-level subdirectory. Nested files (e.g. frontend/.gitignore)
 * are common for monorepos; their patterns are prefixed with the directory so
 * they match correctly when compared against root-relative paths.
 *
 * Deeper nesting isn't followed — the common case is 1–2 levels, and we can
 * revisit if feedback shows we miss relevant patterns.
 */
async function loadGitignoreForRoots(roots: readonly string[]): Promise<readonly string[]> {
  const patterns: string[] = [];
  for (const raw of roots) {
    const abs = resolve(raw);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(abs);
    } catch {
      continue;
    }
    const rootDir = info.isDirectory() ? abs : join(abs, "..");
    await collectGitignores(rootDir, "", patterns);
  }
  return patterns;
}

/** Reads .gitignore at `dir` (prefixed with `prefix` when nested) and recurses one level. */
async function collectGitignores(dir: string, prefix: string, out: string[]): Promise<void> {
  await readIgnoreFileInto(dir, prefix, out);
  // Only recurse one level from the root to avoid an expensive full walk.
  if (prefix !== "") return;
  let entries: Awaited<ReturnType<typeof stat>>;
  try {
    entries = await stat(dir);
  } catch {
    return;
  }
  if (!entries.isDirectory()) return;
  const { readdir } = await import("node:fs/promises");
  const children = await readdir(dir, { withFileTypes: true });
  for (const entry of children) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
    await readIgnoreFileInto(join(dir, entry.name), entry.name, out);
  }
}

async function readIgnoreFileInto(dir: string, prefix: string, out: string[]): Promise<void> {
  try {
    const text = await readFile(join(dir, ".gitignore"), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) continue;
      out.push(prefix === "" ? line : prefixPattern(prefix, line));
    }
  } catch {
    // No .gitignore in this directory — fine.
  }
}

/** Prefixes a nested gitignore pattern with its parent directory. */
function prefixPattern(prefix: string, pattern: string): string {
  // An anchored pattern like `/storybook-static` in frontend/.gitignore
  // becomes `frontend/storybook-static` at the scan root.
  const stripped = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  return `${prefix}/${stripped}`;
}

/** Resolves a single root path into matching files. */
async function discoverOne(
  abs: string,
  userMatcher: GlobMatcher,
  dirMatcher: GlobMatcher,
): Promise<readonly string[]> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(abs);
  } catch {
    return [];
  }
  if (info.isFile()) {
    // Explicit file paths bypass default test-file exclusions, but still
    // honor the user's own excludes.
    if (hasParseableExtension(abs) && !userMatcher.matches(toRel(abs, abs))) return [abs];
    return [];
  }
  if (info.isDirectory()) {
    return walkFiles(
      abs,
      (filePath) => hasParseableExtension(filePath) && !dirMatcher.matches(toRel(filePath, abs)),
      DEFAULT_IGNORED_DIRS,
    );
  }
  return [];
}

/** Path we compare against patterns — POSIX `/` and relative to the scan root. */
function toRel(filePath: string, root: string): string {
  return relative(root, filePath).split(/[\\/]/).join("/");
}

/** Joins a root and a relative sub-path. Exported for tests. */
export function joinRoot(root: string, sub: string): string {
  return join(root, sub);
}
