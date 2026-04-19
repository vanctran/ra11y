/**
 * The `wrapper_introspect` MCP tool. Per ADR 0012, introspection is an
 * AUDIT + DISCOVERY signal — never a silent rewrite of `nativeWrappers`.
 *
 * For each candidate wrapper the tool returns one record:
 *
 *   {
 *     name: string,
 *     definitionFile: string | null,      // null when the probe can't find a file
 *     observedRoot: "button" | "a" | "input" | "div" | "opaque" | "unknown",
 *     confidence: "confirmed" | "assumed" | "unresolved",
 *   }
 *
 * Classification logic lives in `./wrapper-introspect-classify.ts`
 * (pure over `(name, probeFile, definitionFile)`); this module wires
 * the MCP handler — cwd resolution, discovery, per-file-hash cache
 * population, response shape. The split keeps the tool under the
 * cognitive-complexity cap and lets future callers (e.g. a future
 * programmatic API) reuse the classifier without depending on
 * `McpSession`.
 *
 * Caching: per-file-hash, per-session. See
 * `./wrapper-introspect-cache.ts`. Same-contents probe after the first
 * pass returns instantly; a content change invalidates naturally.
 */

import { existsSync } from "node:fs";
import type { ParsedFile } from "../engine/scanner.ts";
import { indexFilesByComponentName, type ProbeFile } from "../engine/wrapper-probe.ts";
import { gitRoot } from "../utils/git.ts";
import {
  errorResult,
  type McpTool,
  parseExplicitPaths,
  parseFiles,
  strArrayParam,
  strParam,
  textResult,
} from "./tools-helpers.ts";
import { type CachedIntrospectionRecord, getOrCompute } from "./wrapper-introspect-cache.ts";
import { classifyResolvedWrapper, unresolvedRecord } from "./wrapper-introspect-classify.ts";

export const wrapperIntrospectTool: McpTool = {
  def: {
    name: "wrapper_introspect",
    description:
      "Classify PascalCase wrapper components by their rendered root element — `button` / `a` / `input` / `div` / `opaque` / `unknown` — with a `confidence` tag (`confirmed` / `assumed` / `unresolved`). Audit and discovery aid ONLY: ra11y NEVER auto-mutates `nativeWrappers` from this output. One-hop basename probe (same policy as `detect_native_wrappers` and the `wrapper/drift` rule); no import following, no transitive resolution. Pair with `propose_config` to promote confirmed wrappers into ra11y.config.ts after you review the definitions yourself. Results are cached per file-hash for the duration of the session; unchanged files return instantly on re-call.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Project root. Defaults to the git root of the MCP server's spawn directory, then process.cwd().",
        },
        additionalPaths: {
          type: "array",
          items: { type: "string" },
          description:
            "Extra paths to include in the basename probe beyond the auto-discovered tree, with `.gitignore` and default build-dir skips bypassed. Use when wrapper definitions live in a sibling package or a build-tools directory the default discovery excludes.",
        },
        names: {
          type: "array",
          items: { type: "string" },
          description:
            "Introspect only these component names. When omitted, every candidate surfaced by the same basename scan `detect_native_wrappers` uses gets a record. Pass an explicit list when you already know the wrappers you care about — skips the full enumeration, keeps the probe deterministic on a narrow set.",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    if (explicitCwd !== undefined && !existsSync(explicitCwd)) {
      return errorResult({
        code: "cwd-not-found",
        message: `Requested cwd does not exist on disk: ${explicitCwd}`,
        details: { cwd: explicitCwd },
        remediation:
          "Pass `cwd` as a path to an existing directory. Relative paths resolve against the MCP server's spawn directory.",
      });
    }

    const spawnCwd = process.cwd();
    const root = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;

    const files = await parseFiles([root], session, root);
    const extra = strArrayParam(params, "additionalPaths") ?? [];
    const extraFiles = extra.length > 0 ? await parseExplicitPaths(extra, session, root) : [];
    const allFiles: readonly ParsedFile[] = dedupByPath([...files, ...extraFiles]);

    const index = indexFilesByComponentName(allFiles.map(toProbeFile));
    const parsedByPath = new Map(allFiles.map((f) => [f.filePath, f]));
    const names = resolveTargetNames(strArrayParam(params, "names"), allFiles);

    let cacheHits = 0;
    let cacheMisses = 0;
    const records: CachedIntrospectionRecord[] = [];
    for (const name of names) {
      const probeFile = index.get(name);
      const parsed = probeFile === undefined ? undefined : parsedByPath.get(probeFile.filePath);
      if (probeFile === undefined || parsed === undefined) {
        // Unresolved path: no file to hash, so we don't populate the
        // per-hash cache. An `unresolved` probe is cheap to repeat —
        // the cache is for "we parsed and classified a file," not
        // for "we searched and found nothing."
        records.push(unresolvedRecord(name));
        continue;
      }
      const { record, cacheHit } = getOrCompute(session, parsed.filePath, parsed.source, () =>
        classifyResolvedWrapper(name, toProbeFile(parsed), parsed.filePath),
      );
      if (cacheHit) cacheHits += 1;
      else cacheMisses += 1;
      records.push(record);
    }

    const confirmedCount = records.filter((r) => r.confidence === "confirmed").length;
    const nextStep = buildNextStep({ total: records.length, confirmedCount });

    return textResult({
      records,
      meta: {
        scannedRoot: root,
        filesScanned: allFiles.length,
        namesIntrospected: names.length,
        // `cacheHits` / `cacheMisses` are scan-confidence telemetry
        // per CLAUDE.md §1 "Verbose meta is signal." An agent can
        // tell a warm second call from a cold first call without
        // timing the response.
        cacheHits,
        cacheMisses,
      },
      nextStep: nextStep.prose,
      nextStepStructured: nextStep.structured,
    });
  },
};

/**
 * Resolves the list of component names to introspect. When the caller
 * passes `names`, that list is canonical (order preserved, duplicates
 * dropped). Otherwise we enumerate every PascalCase-basename file in
 * the parsed set — same source of truth the `detect_native_wrappers`
 * basename probe uses. Sorted alphabetically on the auto-path so the
 * output order is deterministic across runs.
 */
function resolveTargetNames(
  explicit: readonly string[] | undefined,
  files: readonly ParsedFile[],
): readonly string[] {
  if (explicit !== undefined) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of explicit) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }
  const index = indexFilesByComponentName(files.map(toProbeFile));
  return [...index.keys()].sort();
}

/** Adapts a scanner `ParsedFile` onto the minimal shape the probe needs. */
function toProbeFile(file: ParsedFile): ProbeFile {
  return { filePath: file.filePath, language: file.ast.language, root: file.ast.root };
}

/**
 * Drops duplicate `ParsedFile` entries by absolute path — `parseFiles`
 * and `parseExplicitPaths` can overlap when a caller lists a path that
 * `.gitignore` doesn't exclude.
 */
function dedupByPath(files: readonly ParsedFile[]): readonly ParsedFile[] {
  const seen = new Set<string>();
  const out: ParsedFile[] = [];
  for (const f of files) {
    if (seen.has(f.filePath)) continue;
    seen.add(f.filePath);
    out.push(f);
  }
  return out;
}

/**
 * Hints the agent at the next productive call:
 *   - Every record confirmed → suggest `propose_config` to promote.
 *   - Some confirmed, some not → suggest `detect_native_wrappers` for
 *     broader discovery.
 *   - Zero records or zero confirmed → also suggest
 *     `detect_native_wrappers` but phrased for the "nothing to
 *     promote yet" state.
 *
 * Conditional-spread pair discipline: prose + structured emit together.
 */
function buildNextStep(args: { readonly total: number; readonly confirmedCount: number }): {
  readonly prose: string;
  readonly structured: { readonly tool: string; readonly args: Record<string, unknown> };
} {
  const { total, confirmedCount } = args;
  if (total === 0) {
    return {
      prose:
        "No wrapper candidates found in this scan — nothing to classify. Run `detect_native_wrappers` to widen discovery across the project.",
      structured: { tool: "detect_native_wrappers", args: {} },
    };
  }
  if (confirmedCount === total) {
    return {
      prose: `Every introspected wrapper (${total}) has a confirmed native-interactive root. Call \`propose_config\` to synthesize a ra11y.config.ts with these names in \`nativeWrappers\`.`,
      structured: { tool: "propose_config", args: {} },
    };
  }
  if (confirmedCount === 0) {
    return {
      prose: `No wrappers confirmed native-interactive yet (${total} introspected). Call \`detect_native_wrappers\` to widen candidate discovery, then re-introspect with \`names\` narrowed to the ones you want to promote.`,
      structured: { tool: "detect_native_wrappers", args: {} },
    };
  }
  return {
    prose: `${confirmedCount} of ${total} introspected wrappers confirmed native-interactive; the rest are \`assumed\` or \`unresolved\` — read each definitionFile before promoting. Call \`detect_native_wrappers\` for broader discovery.`,
    structured: { tool: "detect_native_wrappers", args: {} },
  };
}
