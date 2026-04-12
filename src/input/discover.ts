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
}

/** Resolves every input path into a flat list of parseable files. */
export async function discoverFiles(
  roots: readonly string[],
  options: DiscoverOptions = {},
): Promise<string[]> {
  const excludes = options.excludes ?? [];
  const out = new Set<string>();

  for (const raw of roots) {
    const abs = resolve(raw);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(abs);
    } catch {
      // Missing path — skip silently, the CLI layer decides whether
      // to warn.
      continue;
    }
    if (info.isFile()) {
      if (hasParseableExtension(abs) && !isExcluded(abs, excludes)) {
        out.add(abs);
      }
      continue;
    }
    if (info.isDirectory()) {
      const files = await walkFiles(
        abs,
        (filePath) => hasParseableExtension(filePath) && !isExcluded(filePath, excludes),
        DEFAULT_IGNORED_DIRS,
      );
      for (const f of files) out.add(f);
    }
  }

  return [...out].sort();
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
