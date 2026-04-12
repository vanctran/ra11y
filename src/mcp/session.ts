/**
 * MCP session state — configuration defaults + AST cache for warm re-scans.
 *
 * Each MCP server connection holds one Session. The `configure` tool mutates
 * session defaults (standard, level, excludes) so subsequent calls don't
 * repeat params. Parsed files are cached by absolute path + mtime so the
 * scan→fix→rescan loop is sub-10ms on the second pass.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseInlineDisables } from "../config/index.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import { parseCss, parseHtml, parseTsx } from "../input/parsers/index.ts";
import type { Ast } from "../types/ast.ts";

/** Cached entry: AST + metadata keyed by absolute path. */
interface CacheEntry {
  readonly parsed: ParsedFile;
  readonly mtimeMs: number;
}

export interface SessionConfig {
  standard: string;
  level: "A" | "AA" | "AAA";
  exclude: readonly string[];
}

export class McpSession {
  readonly config: SessionConfig;
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor() {
    this.config = {
      standard: "wcag22",
      level: "AA",
      exclude: [],
    };
  }

  /** Update session defaults. Returns the new active config. */
  configure(opts: {
    standard?: string;
    level?: "A" | "AA" | "AAA";
    exclude?: readonly string[];
  }): SessionConfig {
    if (opts.standard !== undefined) this.config.standard = opts.standard;
    if (opts.level !== undefined) this.config.level = opts.level;
    if (opts.exclude !== undefined) this.config.exclude = opts.exclude;
    return { ...this.config };
  }

  /**
   * Parses a file, returning a cached result when the file hasn't changed.
   * Returns null for unsupported extensions.
   */
  async parseFile(filePath: string): Promise<ParsedFile | null> {
    const abs = resolve(filePath);
    const info = await stat(abs);
    const cached = this.cache.get(abs);
    if (cached && cached.mtimeMs === info.mtimeMs) {
      return cached.parsed;
    }

    const source = await readFile(abs, "utf8");
    const ast = parseForExtension(abs, source);
    if (!ast) return null;

    const parsed: ParsedFile = {
      filePath,
      source,
      ast,
      disableMap: parseInlineDisables(source),
    };

    this.cache.set(abs, { parsed, mtimeMs: info.mtimeMs });
    return parsed;
  }

  /** Invalidate all cached entries. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Number of cached files (for diagnostics). */
  get cacheSize(): number {
    return this.cache.size;
  }
}

function parseForExtension(filePath: string, source: string): Ast | null {
  if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
    const r = parseHtml(source);
    return { language: "html", root: r.root, errors: r.errors };
  }
  if (filePath.endsWith(".css")) {
    const r = parseCss(source);
    return { language: "css", root: r.root, errors: r.errors };
  }
  if (
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".jsx") ||
    filePath.endsWith(".ts") ||
    filePath.endsWith(".js")
  ) {
    const r = parseTsx(source);
    return { language: "tsx", root: r.root, errors: r.errors };
  }
  return null;
}
