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
import { loadConfig } from "../config/index.ts";
import { parseInlineDisablesDetailed } from "../config/inline-disables.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import { parseCss, parseHtml, parseTsx } from "../input/parsers/index.ts";
import type { Ast } from "../types/ast.ts";
import type { LoadedConfig, RuleSetting } from "../types/config.ts";
import { LoggingState } from "./logging.ts";

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
  /**
   * PascalCase components the session has verified wrap native interactive
   * elements. `keyboard/handler-missing` skips info notes on these.
   */
  nativeWrappers: readonly string[];
  /**
   * When true, tools that mutate user source (`apply_fix`) are permitted to
   * write to disk. Defaults to false: the host must opt-in via `configure`
   * (or the `--allow-write` CLI flag equivalent) before any on-disk edit
   * happens. Read-only tool calls ignore this flag entirely.
   */
  allowWrite: boolean;
}

/**
 * One host-declared project root. The MCP `roots` capability flows
 * from client → server — hosts list directories they consider the
 * active project, and we fall back onto the first root when the
 * caller omits `cwd` on scan-scoped tools. The `name` field is
 * advisory (some hosts don't populate it).
 */
export interface SessionRoot {
  readonly uri: string;
  readonly name?: string;
}

/**
 * Host-declared capabilities as seen in `initialize.params.capabilities`.
 * These are CLIENT capabilities (the reverse direction from the server's
 * own advertised capabilities) — their presence tells us which
 * server-initiated methods the host is willing to answer. We key off
 * `sampling` to decide whether `sampling/createMessage` is usable or
 * we must degrade to returning the prompt for the agent to run
 * directly.
 */
export interface HostCapabilities {
  readonly sampling: boolean;
  readonly roots: boolean;
  readonly elicitation: boolean;
}

/**
 * Server-to-host JSON-RPC request sender. Wired by `startMcpServer`
 * after it sets up the bidirectional read loop. Tools that need
 * sampling (or any future host-initiated call) retrieve this via
 * `session.sendRequest` and await the correlated response.
 *
 * `null` when no transport is attached — e.g. during unit tests that
 * exercise tool handlers without a running server. Callers must
 * handle that case explicitly rather than rely on a throwing stub.
 */
export type SendRequest = (method: string, params: unknown, timeoutMs: number) => Promise<unknown>;

export class McpSession {
  readonly config: SessionConfig;
  readonly logging: LoggingState;
  private readonly cache: Map<string, CacheEntry> = new Map();
  private rootsList: readonly SessionRoot[] = [];
  private hostCaps: HostCapabilities = { sampling: false, roots: false, elicitation: false };
  /**
   * Server-to-host sender. Null until `startMcpServer` wires it to the
   * bidirectional stdio loop. Tools that need sampling check for null
   * first and fall back to returning the prompt.
   */
  sendRequest: SendRequest | null = null;

  constructor() {
    this.config = {
      standard: "wcag22",
      level: "AA",
      exclude: [],
      rules: {},
      nativeWrappers: [],
      allowWrite: false,
    };
    this.logging = new LoggingState();
  }

  /**
   * Record the capability object the host declared in
   * `initialize.params.capabilities`. Only presence matters per spec —
   * values are reserved for future extensions.
   */
  setHostCapabilities(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const obj = raw as Record<string, unknown>;
    this.hostCaps = {
      sampling: "sampling" in obj,
      roots: "roots" in obj,
      elicitation: "elicitation" in obj,
    };
  }

  /** Read-only view of host-declared capabilities from `initialize`. */
  get hostCapabilities(): HostCapabilities {
    return this.hostCaps;
  }

  /**
   * Replace the known set of host-declared roots. Called once from
   * `initialize` (we read `params.roots` defensively) and again on
   * `notifications/roots/list_changed`. Pure mutation — no scans
   * re-trigger; the next tool call picks them up.
   */
  setRoots(roots: readonly SessionRoot[]): void {
    this.rootsList = [...roots];
  }

  /**
   * Read-only view of currently declared roots. Empty when the host
   * did not advertise the `roots` capability or returned an empty
   * list. Tools degrade gracefully in that case.
   */
  get roots(): readonly SessionRoot[] {
    return this.rootsList;
  }

  /**
   * Absolute filesystem path of the first declared root, if any.
   * `scan_project` uses this as a default scan scope when the caller
   * has not passed `cwd` explicitly. URIs that aren't `file://` are
   * ignored (we can't scan a URL-only root).
   */
  firstRootPath(): string | null {
    for (const root of this.rootsList) {
      const p = fileUriToPath(root.uri);
      if (p !== null) return p;
    }
    return null;
  }

  /**
   * Loads the project's ra11y.config.ts for a given cwd.
   *
   * Not cached: an agent that creates the config file partway through a
   * session (after a "where do I put nativeWrappers?" answer) expects the
   * next scan to pick it up. A cache keyed by cwd silently returned stale
   * null results. The load is a handful of existsSync calls + one dynamic
   * import — trivially fast compared to a scan.
   */
  loadProjectConfig(cwd: string): Promise<LoadedConfig> {
    return loadConfig({ cwd });
  }

  /**
   * Merges session rule overrides with the project config's rules.
   * Session rules win — an explicit `configure({ rules })` call beats
   * the file. This is the same precedence the CLI uses.
   */
  effectiveRules(projectConfig: LoadedConfig): Record<string, RuleSetting> {
    return { ...projectConfig.rules, ...this.config.rules };
  }

  /** Update session defaults. Returns the new active config. */
  configure(opts: {
    standard?: string;
    level?: "A" | "AA" | "AAA";
    exclude?: readonly string[];
    rules?: Readonly<Record<string, RuleSetting>>;
    nativeWrappers?: readonly string[];
    allowWrite?: boolean;
  }): SessionConfig {
    if (opts.standard !== undefined) this.config.standard = opts.standard;
    if (opts.level !== undefined) this.config.level = opts.level;
    if (opts.exclude !== undefined) this.config.exclude = opts.exclude;
    if (opts.rules !== undefined) {
      // Merge: new overrides replace per key, existing keep.
      this.config.rules = { ...this.config.rules, ...opts.rules };
    }
    if (opts.nativeWrappers !== undefined) {
      // Union with existing so repeated configure() calls accumulate.
      this.config.nativeWrappers = [
        ...new Set([...this.config.nativeWrappers, ...opts.nativeWrappers]),
      ];
    }
    if (opts.allowWrite !== undefined) this.config.allowWrite = opts.allowWrite;
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

    const { disableMap, declarations } = parseInlineDisablesDetailed(source);
    const parsed: ParsedFile = {
      filePath,
      source,
      ast,
      disableMap,
      declarations,
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

/**
 * Convert an MCP root URI (`file://...`) to an absolute filesystem
 * path. Non-`file` schemes return null — we can't scan an HTTP URL.
 * Also tolerates hosts that drop the scheme and send bare absolute
 * paths, since that's the most common real-world mistake.
 */
function fileUriToPath(uri: string): string | null {
  if (uri.length === 0) return null;
  if (uri.startsWith("file://")) {
    const rest = uri.slice("file://".length);
    // file:///abs/path → /abs/path; file://host/path → reject (remote)
    if (rest.startsWith("/")) return decodeURIComponent(rest);
    return null;
  }
  if (isAbsolute(uri)) return uri;
  return null;
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
