/**
 * Path helpers. Thin wrappers around node:path that narrow our surface
 * to just what the scanner needs.
 */

import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export { extname, isAbsolute, join, relative, resolve, sep };

/** Returns the POSIX extension of a file (e.g., ".tsx"), or empty string. */
export function extension(filePath: string): string {
  return extname(filePath).toLowerCase();
}

/** True if the path ends with a known parseable extension. */
export function hasParseableExtension(filePath: string): boolean {
  return PARSEABLE_EXTENSIONS.has(extension(filePath));
}

const PARSEABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".html",
  ".htm",
  ".css",
]);

/**
 * True when the file's basename matches the Storybook story-file
 * convention: `Foo.stories.{tsx,jsx,ts,js}` or `Foo.story.{tsx,jsx,ts,js}`.
 * Used by `preset: "storybook"` plumbing to decide per-file whether
 * Storybook-specific transparency applies. Case-sensitive on the
 * `.stories` / `.story` marker (Storybook itself is) and accepts both
 * `/` and `\` path separators for Windows paths.
 */
export function isStorybookStoryFile(filePath: string): boolean {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const basename = lastSep === -1 ? filePath : filePath.slice(lastSep + 1);
  return STORY_BASENAME_RE.test(basename);
}

/** Matches `<name>.stories.<ext>` or `<name>.story.<ext>` basenames. */
const STORY_BASENAME_RE = /^[^.]+\.(?:stories|story)\.(?:tsx|jsx|ts|js)$/;

/**
 * True if `fileExt` matches any entry in `allowList`. A rule that declares
 * `.jsx` implicitly covers `.js` too, and `.tsx` implicitly covers `.ts` —
 * Next.js and other frameworks routinely ship JSX inside `.js` files, and
 * the TSX parser handles both alike, so the rule's extension filter must
 * agree. Rules that want to opt out of the alias can list extensions
 * explicitly.
 */
export function extensionMatches(fileExt: string, allowList: readonly string[]): boolean {
  if (allowList.length === 0) return true;
  if (allowList.includes(fileExt)) return true;
  if (fileExt === ".js" && allowList.includes(".jsx")) return true;
  if (fileExt === ".ts" && allowList.includes(".tsx")) return true;
  return false;
}
