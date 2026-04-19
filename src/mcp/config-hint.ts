/**
 * Config-discovery hint builder for `scan_project`. Extracted so
 * `tool-scan-project.ts` stays inside the 500-effective-line budget;
 * the logic is narrow (walk a few ancestor directories looking for a
 * `ra11y.config.*` file, phrase the retry instruction accordingly)
 * and has no other callers.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_FILENAMES = [
  "ra11y.config.ts",
  "ra11y.config.js",
  "ra11y.config.mjs",
  "ra11y.config.json",
] as const;

const MAX_ANCESTORS_TO_SEARCH = 6;

/**
 * When config discovery failed AND the caller didn't pass `cwd`
 * explicitly, warn that the server's spawn directory is almost
 * certainly the wrong place to look. If a ra11y.config.* file is
 * reachable by walking up the filesystem from the spawn dir (past the
 * .git barrier that stops the loader), name its exact path so agents
 * can retry with the right cwd in one step instead of spelunking.
 */
export function buildConfigHint(
  sourcePath: string | null,
  explicitCwd: string | undefined,
  resolvedCwd: string,
  autoPromoted: boolean,
): string | null {
  if (sourcePath !== null) return null;
  // Only surface the hint when there's something actionable the agent
  // can do about it. A project that genuinely has no ra11y.config and
  // is scanned with the correct cwd needs no repeated warning — the
  // hint must earn its place in every response, not be wallpaper.
  const nearby = findNearbyConfig(resolvedCwd);
  if (nearby !== null) {
    return `No ra11y.config found walking up from ${resolvedCwd}${explicitCwd === undefined ? " (the MCP server's spawn directory)" : ""}. A config exists at ${nearby} — retry with \`cwd: "${dirname(nearby)}"\` to load it.`;
  }
  // No nearby config and caller was explicit about cwd: they're
  // running on defaults intentionally. Silent.
  if (explicitCwd !== undefined) return null;
  // No explicit cwd, no config, no nearby candidate — warn that the
  // spawn directory probably isn't the project root.
  if (!autoPromoted) {
    return `No ra11y.config was found walking up from ${resolvedCwd} (the MCP server's spawn directory). If your project root is elsewhere, pass \`cwd\` pointing at it — the loader will then find both the config and the project's .gitignore.`;
  }
  return null;
}

/**
 * Searches ancestor directories (past .git, which the normal loader
 * stops at) for a ra11y.config.* file. Bounded to a few levels so we
 * don't crawl the entire filesystem on every scan.
 */
function findNearbyConfig(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < MAX_ANCESTORS_TO_SEARCH; i += 1) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(dir, filename);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
