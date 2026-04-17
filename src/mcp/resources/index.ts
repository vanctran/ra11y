/**
 * MCP resources — exposes `docs/kb/**` as a read-only resource surface.
 *
 * The KB is ra11y's canonical retrieval target for agents (see CLAUDE.md §12).
 * Every markdown file under `docs/kb/` is advertised through `resources/list`
 * with a stable `ra11y-kb://<relative-path>` URI; `resources/read` resolves
 * that URI back to disk and returns the raw text.
 *
 * Design notes:
 *   - Scheme is `ra11y-kb://` so URIs don't collide with other servers the
 *     same host might load.
 *   - `name` is the document's first `# ` heading when present, falling back
 *     to the filename. `description` is the frontmatter `description` field,
 *     the first heading's following paragraph, or the first non-frontmatter
 *     paragraph — whichever lands first with usable text.
 *   - Listing is stable-sorted by URI so agents can diff inventory between
 *     sessions.
 *   - Path resolution rejects any URI that escapes `docs/kb/` (scheme check,
 *     `..` segment ban, resolved-path-prefix check).
 *   - No caching. KB churn is developer-time; agent calls to these handlers
 *     are rare compared to a filesystem walk.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const URI_SCHEME = "ra11y-kb://";
const KB_SUBDIR = join("docs", "kb");
const MD_EXT = ".md";
const MIME_MARKDOWN = "text/markdown";

/** JSON-RPC error codes that `resources/read` may raise. Mirrors server.ts. */
export const RESOURCE_NOT_FOUND = -32002;
export const INVALID_RESOURCE_URI = -32602;

export interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly description?: string;
}

export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

/** Error thrown by `readKbResource` for a rejected URI. The caller maps
 * the `code` onto a JSON-RPC error. */
export class ResourceError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "ResourceError";
    this.code = code;
  }
}

/**
 * Enumerate every markdown file under `<cwd>/docs/kb/` as an MCP resource.
 * Returns an empty list when the directory is absent — an agent calling
 * `resources/list` before the KB exists should see a clean empty response,
 * not an error.
 */
export async function loadKbResources(cwd: string): Promise<McpResource[]> {
  const kbRoot = join(cwd, KB_SUBDIR);
  const files = await walkMarkdown(kbRoot).catch(() => [] as string[]);
  const resources: McpResource[] = [];
  for (const abs of files) {
    const rel = relative(kbRoot, abs).split(sep).join("/");
    const uri = `${URI_SCHEME}${rel}`;
    const source = await readFile(abs, "utf8").catch(() => "");
    const { name, description } = extractMeta(source, rel);
    resources.push({
      uri,
      name,
      mimeType: MIME_MARKDOWN,
      ...(description ? { description } : {}),
    });
  }
  resources.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  return resources;
}

/**
 * Resolve a `ra11y-kb://<relative>` URI to a concrete file under
 * `<cwd>/docs/kb/` and return its contents. Throws a `ResourceError` for
 * any URI that:
 *   - Is not the `ra11y-kb://` scheme
 *   - Contains a `..` path segment
 *   - Resolves outside the KB root (symlink-ish defence via prefix check)
 *   - Points at a file that does not exist
 */
export async function readKbResource(cwd: string, uri: string): Promise<McpResourceContent> {
  if (typeof uri !== "string" || !uri.startsWith(URI_SCHEME)) {
    throw new ResourceError(INVALID_RESOURCE_URI, `Unsupported URI scheme: ${uri}`);
  }
  const rel = uri.slice(URI_SCHEME.length);
  if (rel.length === 0) {
    throw new ResourceError(INVALID_RESOURCE_URI, "Empty resource path.");
  }
  // Reject dotdot segments explicitly; the prefix check below catches
  // the same escape, but an explicit message is friendlier for agents.
  const segments = rel.split(/[\\/]/);
  if (segments.some((s) => s === "..")) {
    throw new ResourceError(INVALID_RESOURCE_URI, `Path traversal rejected: ${uri}`);
  }
  const kbRoot = resolve(cwd, KB_SUBDIR);
  const target = resolve(kbRoot, rel);
  const rooted = target === kbRoot || target.startsWith(kbRoot + sep);
  if (!rooted) {
    throw new ResourceError(INVALID_RESOURCE_URI, `Path escapes KB root: ${uri}`);
  }
  const text = await readFile(target, "utf8").catch((err: unknown) => {
    throw new ResourceError(
      RESOURCE_NOT_FOUND,
      `Resource not found: ${uri} (${err instanceof Error ? err.message : String(err)})`,
    );
  });
  return { uri, mimeType: MIME_MARKDOWN, text };
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkMarkdown(full);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(MD_EXT)) {
      out.push(full);
    }
  }
  return out;
}

interface KbMeta {
  readonly name: string;
  readonly description?: string;
}

/**
 * Derive `name` and `description` from a markdown document. We parse the
 * document head cheaply: YAML frontmatter (if present) for `description`,
 * then the first `# ` heading for `name`, then the first following
 * non-empty paragraph as description fallback. Falls back to basename
 * so `name` is always populated.
 */
function extractMeta(source: string, relPath: string): KbMeta {
  const { frontmatter, body } = splitFrontmatter(source);
  const lines = body.split("\n");
  const startIdx = skipBlankLines(lines, 0);

  const { name: headingName, nextIdx } = findHeadingName(lines, startIdx);
  const name = frontmatter.get("title") ?? headingName ?? basenameWithoutExt(relPath);

  const description = frontmatter.get("description") ?? findFirstParagraph(lines, nextIdx) ?? "";

  return {
    name,
    ...(description ? { description } : {}),
  };
}

function skipBlankLines(lines: readonly string[], from: number): number {
  let i = from;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  return i;
}

function findHeadingName(
  lines: readonly string[],
  from: number,
): { readonly name: string | undefined; readonly nextIdx: number } {
  for (let j = from; j < lines.length; j++) {
    const m = /^#\s+(.+)$/.exec((lines[j] ?? "").trim());
    if (m) return { name: stripInlineFormatting(m[1] ?? ""), nextIdx: j + 1 };
  }
  return { name: undefined, nextIdx: from };
}

function findFirstParagraph(lines: readonly string[], from: number): string | undefined {
  for (let j = from; j < lines.length; j++) {
    const trimmed = (lines[j] ?? "").trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) continue;
    return stripInlineFormatting(trimmed);
  }
  return undefined;
}

function basenameWithoutExt(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.md$/, "");
}

/**
 * Parse a minimal YAML frontmatter block. We only support `key: value` pairs
 * — the generators emit exactly that shape. Unquoted values are used raw;
 * a quoted value has its outer quotes stripped. No list, no nesting.
 */
function splitFrontmatter(source: string): {
  readonly frontmatter: Map<string, string>;
  readonly body: string;
} {
  const empty = new Map<string, string>();
  if (!(source.startsWith("---\n") || source.startsWith("---\r\n"))) {
    return { frontmatter: empty, body: source };
  }
  const rest = source.slice(source.indexOf("\n") + 1);
  const endIdx = rest.indexOf("\n---");
  if (endIdx === -1) return { frontmatter: empty, body: source };
  const block = rest.slice(0, endIdx);
  const afterFence = rest.slice(endIdx + "\n---".length);
  const body = afterFence.startsWith("\n") ? afterFence.slice(1) : afterFence;
  return { frontmatter: parseFrontmatterBlock(block), body };
}

function parseFrontmatterBlock(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of block.split("\n")) {
    const entry = parseFrontmatterLine(raw);
    if (entry) map.set(entry.key, entry.value);
  }
  return map;
}

function parseFrontmatterLine(
  raw: string,
): { readonly key: string; readonly value: string } | undefined {
  const line = raw.trim();
  if (line === "" || line.startsWith("#")) return undefined;
  const colon = line.indexOf(":");
  if (colon === -1) return undefined;
  const key = line.slice(0, colon).trim();
  if (key.length === 0) return undefined;
  return { key, value: unquote(line.slice(colon + 1).trim()) };
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Lightweight markdown-to-plain conversion for `name`/`description` fields.
 * Strips backticks, emphasis markers, and link syntax so the text survives
 * JSON serialization without extra escaping.
 */
function stripInlineFormatting(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .trim();
}
