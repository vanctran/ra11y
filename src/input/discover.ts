/**
 * File discovery.
 *
 * Expands the set of paths given on the command line into a flat list
 * of parseable files. Applies:
 *
 *   - Default ignored directories (node_modules, dist, .git, etc.)
 *   - Extension allow-list (only .tsx/.jsx/.ts/.js/.html/.htm/.css)
 *   - User exclude globs (simple substring match for v0.0.x)
 *
 * Entry points:
 *   - `discoverFiles(roots, excludes)` takes a list of cwd-relative
 *     paths (directories or files) and returns resolved absolute
 *     file paths.
 */

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_IGNORED_DIRS, walkFiles } from "../utils/fs.ts";
import { hasParseableExtension } from "../utils/path.ts";

export interface DiscoverOptions {
  readonly excludes?: readonly string[];
  /** When true, skip default test-file exclusions. */
  readonly includeTests?: boolean;
}

/**
 * File patterns excluded by default. Test files aren't shipped UI —
 * scanning them produces noise (render assertions, mocks, etc.).
 * Users can override via config excludes or `includeTests: true`.
 */
const DEFAULT_EXCLUDED_PATTERNS: readonly string[] = [".test.", ".spec.", "__tests__", "__mocks__"];

/** Resolves every input path into a flat list of parseable files. */
export async function discoverFiles(
  roots: readonly string[],
  options: DiscoverOptions = {},
): Promise<string[]> {
  const userExcludes = options.excludes ?? [];
  const dirExcludes = buildDirExcludes(userExcludes, options.includeTests === true);
  const out = new Set<string>();

  for (const raw of roots) {
    const found = await discoverOne(resolve(raw), userExcludes, dirExcludes);
    for (const f of found) out.add(f);
  }

  return [...out].sort();
}

/** Merges default test-file patterns with user excludes for directory walks. */
function buildDirExcludes(
  userExcludes: readonly string[],
  includeTests: boolean,
): readonly string[] {
  return includeTests ? userExcludes : [...DEFAULT_EXCLUDED_PATTERNS, ...userExcludes];
}

/** Resolves a single root path into matching files. */
async function discoverOne(
  abs: string,
  userExcludes: readonly string[],
  dirExcludes: readonly string[],
): Promise<readonly string[]> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(abs);
  } catch {
    return [];
  }
  if (info.isFile()) {
    // Explicit file paths bypass default test-file exclusions.
    if (hasParseableExtension(abs) && !isExcluded(abs, userExcludes)) return [abs];
    return [];
  }
  if (info.isDirectory()) {
    return walkFiles(
      abs,
      (filePath) => hasParseableExtension(filePath) && !isExcluded(filePath, dirExcludes),
      DEFAULT_IGNORED_DIRS,
    );
  }
  return [];
}

function isExcluded(filePath: string, excludes: readonly string[]): boolean {
  for (const pattern of excludes) {
    if (filePath.includes(pattern)) return true;
  }
  return false;
}

/** Joins a root and a relative sub-path. Exported for tests. */
export function joinRoot(root: string, sub: string): string {
  return join(root, sub);
}
