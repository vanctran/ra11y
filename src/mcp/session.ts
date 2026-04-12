/**
 * MCP session state — configuration defaults + AST cache for warm re-scans.
 *
 * Each MCP server connection holds one Session. The `configure` tool mutates
 * session defaults (standard, level, excludes) so subsequent calls don't
 * repeat params. Parsed files are cached by absolute path + mtime so the
 * scan→fix→rescan loop is sub-10ms on the second pass.
 */

import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parseInlineDisables } from "../config/index.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import { parseCss, parseHtml, parseTsx } from "../input/parsers/index.ts";
import type { Ast } from "../types/ast.ts";
import type { RuleSetting } from "../types/config.ts";

/** Cached entry: AST + metadata keyed by absolute path. */
interface CacheEntry {
  readonly parsed: ParsedFile;
  readonly mtimeMs: number;
}

export interface SessionConfig {
  standard: string;
  level: "A" | "AA" | "AAA";
  exclude: readonly string[];
  /** Per-rule severity overrides. "off" disables the rule entirely. */
  rules: Record<string, RuleSetting>;
}

export class McpSession {
  readonly config: SessionConfig;
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor() {
    this.config = {
      standard: "wcag22",
      level: "AA",
      exclude: [],
      rules: {},
    };
  }

  /** Update session defaults. Returns the new active config. */
  configure(opts: {
    standard?: string;
    level?: "A" | "AA" | "AAA";
    exclude?: readonly string[];
    rules?: Readonly<Record<string, RuleSetting>>;
  }): SessionConfig {
    if (opts.standard !== undefined) this.config.standard = opts.standard;
    if (opts.level !== undefined) this.config.level = opts.level;
    if (opts.exclude !== undefined) this.config.exclude = opts.exclude;
    if (opts.rules !== undefined) {
      // Merge: new overrides replace per key, existing keep.
      this.config.rules = { ...this.config.rules, ...opts.rules };
    }
    return { ...this.config, rules: { ...this.config.rules } };
  }

  /**
   * Parses a file, returning a cached result when the file hasn't changed.
   * Returns null for unsupported extensions.
   *
   * Relative paths resolve against `cwd` (or `process.cwd()` if omitted).
   * Callers can pass a `cwd` per scan so agents working in git worktrees
   * don't collide with the server's spawn-time working directory.
   */
  async parseFile(filePath: string, cwd?: string): Promise<ParsedFile | null> {
    const abs = isAbsolute(filePath) ? filePath : resolve(cwd ?? process.cwd(), filePath);
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
