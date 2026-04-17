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
import { dirname, join, relative, resolve } from "node:path";
import { DEFAULT_IGNORED_DIRS, walkFiles } from "../utils/fs.ts";
import { compileGlobs, type GlobMatcher } from "../utils/glob.ts";
import { hasParseableExtension } from "../utils/path.ts";

/**
 * A minimal directory-ignore set used by `discoverExplicitPaths`.
 * The agent opt-ed in by listing these paths explicitly (typically
 * `dist/` or `build/`), so the usual `dist`/`build`/`out`/etc. skips
 * don't apply. `node_modules` and `.git` stay excluded — walking them
 * from a build directory is never the intent and produces nothing but
 * noise.
 */
const EXPLICIT_PATH_IGNORED_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git"]);

export interface DiscoverOptions {
  /** User-supplied gitignore-style patterns. */
  readonly excludes?: readonly string[];
  /** When true, skip default test-file exclusions. */
  readonly includeTests?: boolean;
  /** When false, don't auto-load .gitignore. Default true. */
  readonly respectGitignore?: boolean;
}

/**
 * File patterns excluded by default. Test files, Storybook stories, and
 * mock fixtures aren't shipped UI — scanning them produces noise
 * (onChange on filter bars, render assertions, sample copy that happens
 * to contain "click below"). Users can re-include with `includeTests`.
 */
const DEFAULT_EXCLUDED_PATTERNS: readonly string[] = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.*",
  "**/*.story.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/stories/**",
  "**/dev-tools/**",
  "**/devtools/**",
];

/**
 * Opt-in discovery that treats each path as an explicit "please scan
 * this" — bypasses both `.gitignore` and the default-ignored-dirs
 * (`dist`, `build`, `out`, `.next`, …). Used by scan_project's
 * `additionalPaths` param so an agent can point the scanner at
 * post-compile CSS/HTML output a Tailwind or bundler produced. Still
 * honors user excludes from config and the parseable-extension filter
 * — we only widen the dir-level skip.
 */
export async function discoverExplicitPaths(
  paths: readonly string[],
  options: { readonly excludes?: readonly string[] } = {},
): Promise<string[]> {
  const userExcludes = options.excludes ?? [];
  const userMatcher = compileGlobs(userExcludes);
  const out = new Set<string>();
  for (const raw of paths) {
    const absRoot = resolve(raw);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(absRoot);
    } catch {
      continue;
    }
    if (info.isFile()) {
      if (hasParseableExtension(absRoot) && !userMatcher.matches(toRel(absRoot, absRoot))) {
        out.add(absRoot);
      }
      continue;
    }
    if (!info.isDirectory()) continue;
    const found = await walkFiles(
      absRoot,
      (filePath) =>
        hasParseableExtension(filePath) && !userMatcher.matches(toRel(filePath, absRoot)),
      EXPLICIT_PATH_IGNORED_DIRS,
    );
    for (const f of found) out.add(f);
  }
  return [...out].sort();
}

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
 * Loads `.gitignore` patterns for each scan root.
 *
 * When a scan root is inside a git repository, every `.gitignore` file
 * between the git root and the scan root also applies — same semantics
 * git itself uses. Without the walk-up, `scan_project({ cwd: <repo> })`
 * and `scan_project({ cwd: <repo>/<subdir> })` would produce different
 * findings for the same tree (the subpath call wouldn't see the root
 * `.gitignore` excluding `dist/` etc.), leading agents to mis-attribute
 * regressions when comparing across `cd` boundaries.
 *
 * Patterns from ancestor `.gitignore` files are translated to be
 * relative to the scan root, then dropped if their anchor falls outside
 * the scan root entirely (an anchored `/dist` at the git root can
 * never match a file under `<repo>/src/app/`).
 *
 * Nested files *inside* the scan root are also collected one level
 * deep — common for monorepos where `frontend/.gitignore` lists build
 * artefacts. Deeper descent isn't followed.
 */
async function loadGitignoreForRoots(roots: readonly string[]): Promise<readonly string[]> {
  const patterns: string[] = [];
  const gitRootCache = new Map<string, string | null>();
  for (const raw of roots) {
    const abs = resolve(raw);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(abs);
    } catch {
      continue;
    }
    const scanRoot = info.isDirectory() ? abs : join(abs, "..");
    const repoRoot = await resolveGitRoot(scanRoot, gitRootCache);
    if (repoRoot !== null && repoRoot !== scanRoot) {
      await collectAncestorGitignores(repoRoot, scanRoot, patterns);
    }
    await collectGitignores(scanRoot, "", patterns);
  }
  return patterns;
}

/**
 * Walks up from `start` looking for a `.git` entry (directory for
 * normal repos, file for worktrees/submodules). Returns the absolute
 * path of the containing directory, or null if we hit the filesystem
 * root without finding one. Results are memoized by input directory so
 * a multi-root scan only pays the walk-up cost once per repo.
 */
async function resolveGitRoot(
  start: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const cached = cache.get(start);
  if (cached !== undefined) return cached;
  const visited: string[] = [];
  let current = start;
  // `dirname("/") === "/"` on posix; use that as the loop terminator.
  while (true) {
    const cachedCurrent = cache.get(current);
    if (cachedCurrent !== undefined) return memoize(cache, visited, cachedCurrent);
    visited.push(current);
    if (await hasGitEntry(current)) return memoize(cache, visited, current);
    const parent = dirname(current);
    if (parent === current) return memoize(cache, visited, null);
    current = parent;
  }
}

/** Returns true if `<dir>/.git` exists as a directory or a file (worktree/submodule). */
async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    const st = await stat(join(dir, ".git"));
    return st.isDirectory() || st.isFile();
  } catch {
    return false;
  }
}

/** Writes `resolved` into every entry of `visited` and returns it. */
function memoize(
  cache: Map<string, string | null>,
  visited: readonly string[],
  resolved: string | null,
): string | null {
  for (const v of visited) cache.set(v, resolved);
  return resolved;
}

/**
 * Reads every `.gitignore` from `repoRoot` down the directory chain
 * to (but not including) `scanRoot`, translating each pattern to be
 * relative to `scanRoot`. Patterns whose anchor falls outside
 * `scanRoot` are dropped.
 */
async function collectAncestorGitignores(
  repoRoot: string,
  scanRoot: string,
  out: string[],
): Promise<void> {
  const chain = ancestorChain(repoRoot, scanRoot);
  for (const dir of chain) {
    await readAncestorIgnoreInto(dir, scanRoot, out);
  }
}

/**
 * Returns `[repoRoot, repoRoot/a, repoRoot/a/b, ...]` — every directory
 * between `repoRoot` (inclusive) and `scanRoot` (exclusive) in order
 * from shallowest to deepest.
 */
function ancestorChain(repoRoot: string, scanRoot: string): readonly string[] {
  const rel = relative(repoRoot, scanRoot);
  if (rel === "" || rel.startsWith("..")) return [];
  const parts = rel.split(/[\\/]/).filter((p) => p.length > 0);
  const out: string[] = [repoRoot];
  let acc = repoRoot;
  // The last segment *is* scanRoot, which is collected separately.
  for (let i = 0; i < parts.length - 1; i += 1) {
    acc = join(acc, parts[i] ?? "");
    out.push(acc);
  }
  return out;
}

/**
 * Reads `<dir>/.gitignore` and emits scan-root-relative patterns.
 *
 * The translation handles three cases:
 *   - Unanchored pattern (e.g. `dist/`): applies at any depth under
 *     `dir`. Since `scanRoot` is under `dir`, the same pattern still
 *     applies at any depth under `scanRoot`. Emit unchanged.
 *   - Anchored pattern (leading `/`, or contains a slash): rooted at
 *     `dir`. Only matches files under `scanRoot` if the anchored path
 *     starts with the dir→scanRoot relative prefix. Strip that prefix
 *     and re-anchor; drop if the anchor points elsewhere.
 */
async function readAncestorIgnoreInto(dir: string, scanRoot: string, out: string[]): Promise<void> {
  let text: string;
  try {
    text = await readFile(join(dir, ".gitignore"), "utf8");
  } catch {
    return;
  }
  const relDirToScan = relative(dir, scanRoot)
    .split(/[\\/]/)
    .filter((p) => p.length > 0);
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) continue;
    const translated = translateAncestorPattern(line, relDirToScan);
    if (translated !== null) out.push(translated);
  }
}

/**
 * Rewrites an ancestor-level gitignore pattern to be relative to the
 * scan root, or returns null if the pattern's anchor puts it outside
 * the scan root (e.g., `/other-pkg/` at repo root when we're scanning
 * `/repo/frontend/`).
 */
function translateAncestorPattern(pattern: string, relDirToScan: readonly string[]): string | null {
  const hadLeadingSlash = pattern.startsWith("/");
  const trailingSlash = pattern.endsWith("/") ? "/" : "";
  const body = pattern.replace(/^\//, "").replace(/\/$/, "");
  const containsSlash = body.includes("/");
  // Per gitignore(5): a slash anywhere in the pattern (except at end) makes
  // it rooted at the `.gitignore`'s directory. A leading `**/` is the one
  // documented exception — it means "at any depth," i.e. unanchored.
  const leadingDoubleStar = body.startsWith("**/");
  const isAnchored = (hadLeadingSlash || containsSlash) && !leadingDoubleStar;

  if (!isAnchored) {
    // Unanchored (including leading `**/`): matches anywhere below the
    // originating dir, which includes anywhere below the scan root.
    // Preserve verbatim.
    return pattern;
  }

  const segments = body.split("/");
  // Must start with the dir→scanRoot path prefix; otherwise the
  // pattern anchors outside the scan root and can't match any file
  // we enumerate.
  for (let i = 0; i < relDirToScan.length; i += 1) {
    if (segments[i] !== relDirToScan[i]) return null;
  }
  const remainder = segments.slice(relDirToScan.length);
  if (remainder.length === 0) {
    // Pattern anchored at the scan root itself — e.g., `/src/app` at
    // the repo root when scanning `/repo/src/app`. The scan root *is*
    // the excluded path; nothing under it would even be a candidate
    // to scan. Emit an anchored `*` so the matcher rejects every file
    // uniformly rather than silently leaking.
    return `/*${trailingSlash}`;
  }
  return `/${remainder.join("/")}${trailingSlash}`;
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
