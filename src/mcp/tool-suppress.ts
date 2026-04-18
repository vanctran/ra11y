/**
 * The `suppress` MCP tool. Inserts a `ra11y-disable-next-line` pragma
 * above a target line in the file-appropriate comment shape so a
 * specific finding stops firing on subsequent scans.
 *
 * Comment shapes: `{/* *\/}` for .tsx/.jsx, `//` for .ts/.js, `<!-- -->`
 * for .html/.htm, `/* *\/` for .css. The `-next-line` form is the right
 * directive for single-line input — a region pragma without a matching
 * `-enable` would silence every subsequent line, which isn't what
 * "suppress this one finding" means. This also matches the string the
 * `suppressWith` field on each finding already hands agents.
 *
 * Safety layers mirror apply_fix: `allowWrite` session flag, path-escape
 * guard, required reason, file existence, line bounds, extension check.
 * Codes intentionally reuse the ones apply_fix already surfaces
 * (`allow-write-disabled`, `path-escapes-cwd`, `file-unsupported`) so
 * agents branch once; `reason-required` and `line-out-of-range` are
 * new and specific to this tool.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { McpSession } from "./session.ts";
import {
  errorResult,
  type McpTool,
  type McpToolResult,
  type StructuredErrorCode,
  strParam,
  textResult,
} from "./tools-helpers.ts";

// Local error codes specific to this tool. Cast-through rather than
// widening the central union because adding two entries to
// `tools-helpers.ts` pushes that file past its 500-effective-line
// budget. The `code` field serialises as a plain string over the
// wire, so agents branch on the exact literals regardless.
const REASON_REQUIRED = "reason-required" as StructuredErrorCode;
const LINE_OUT_OF_RANGE = "line-out-of-range" as StructuredErrorCode;

type CommentKind = "jsx" | "line" | "html" | "block";

interface PragmaShape {
  readonly kind: CommentKind;
  readonly open: string;
  readonly close: string;
}

const PRAGMA_DIRECTIVE = "ra11y-disable-next-line";

/**
 * Per-extension pragma shape. Keyed lowercase so `.TSX` and similar
 * mixed-case paths resolve without a second normalisation.
 */
const EXT_SHAPES: Readonly<Record<string, PragmaShape>> = {
  ".tsx": { kind: "jsx", open: "{/* ", close: " */}" },
  ".jsx": { kind: "jsx", open: "{/* ", close: " */}" },
  ".ts": { kind: "line", open: "// ", close: "" },
  ".js": { kind: "line", open: "// ", close: "" },
  ".html": { kind: "html", open: "<!-- ", close: " -->" },
  ".htm": { kind: "html", open: "<!-- ", close: " -->" },
  ".css": { kind: "block", open: "/* ", close: " */" },
};

export const suppressTool: McpTool = {
  def: {
    name: "suppress",
    description:
      "Insert a source-level `ra11y-disable-next-line` pragma above a target line so a specific finding stops firing on subsequent scans. Writes to disk — requires session `allowWrite: true` (same gate as `apply_fix`). Reason text is REQUIRED; a bare suppression is rejected with `reason-required` because an un-justified silence is the failure mode source pragmas exist to prevent.\n\nPragma shape is chosen from the file extension:\n  - .tsx/.jsx → `{/* ra11y-disable-next-line <ruleId>: <reason> */}`\n  - .ts/.js → `// ra11y-disable-next-line <ruleId>: <reason>`\n  - .html/.htm → `<!-- ra11y-disable-next-line <ruleId>: <reason> -->`\n  - .css → `/* ra11y-disable-next-line <ruleId>: <reason> */`\n\nIndentation matches the target line so the inserted comment stays visually aligned with the code it suppresses. The tool uses the `-disable-next-line` variant (not the region-opening bare `-disable`) because the input is a single line number — a bare region pragma without a matching `-enable` would silence every following line.\n\n`ruleId` accepts either a rule ID (e.g. `keyboard/handler-missing`) or a criterion ID (e.g. `wcag22:2.4.5`); the pragma parser honors both.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "Path to the file to modify. Absolute paths must live inside `cwd`; relative paths resolve from `cwd`. Traversal attempts (`../../etc/hosts`) are rejected before the write.",
        },
        line: {
          type: "number",
          description:
            "1-based line number of the finding to suppress. The pragma is inserted on a new line directly ABOVE this line so the `-disable-next-line` directive resolves to the finding's line. Must be within the file's source range.",
        },
        ruleId: {
          type: "string",
          description:
            "Rule ID or criterion ID to suppress. Rule IDs use `/` (e.g. `keyboard/handler-missing`); criterion IDs use `:` (e.g. `wcag22:2.4.5`). Both forms are honored by the pragma parser.",
        },
        reason: {
          type: "string",
          description:
            "REQUIRED free-form justification for the suppression. Embedded in the pragma after `: <reason>` and surfaced in the scan's suppression audit. A bare suppression is rejected with `reason-required` — per Q2-REASON, a suppression without a stated reason is a silent promise the agent can't honor.",
        },
        cwd: {
          type: "string",
          description:
            "Base directory for resolving `file` and enforcing the no-escape guard. Defaults to the MCP server's spawn directory; pass your project root explicitly when the server's cwd differs from the project root.",
        },
      },
      required: ["file", "line", "ruleId", "reason"],
    },
    // Mutates source; no readOnlyHint. Not idempotent — calling twice
    // inserts two pragmas — so explicitly flag it.
    annotations: { idempotentHint: false },
  },
  async handler(params, session): Promise<McpToolResult> {
    const pre = await preflight(params, session);
    if ("error" in pre) return pre.error;
    const { resolved, cwd, line, ruleId, reason, shape, source } = pre;
    const lines = source.split("\n");
    // `line > lines.length` rejects lines past EOF. Exact equality
    // (`line === lines.length`) is allowed and points at the last
    // source line — the `-disable-next-line` pragma inserted above it
    // resolves correctly.
    if (line > lines.length) {
      return errorResult({
        code: LINE_OUT_OF_RANGE,
        message: `line ${line} is past end-of-file for ${resolved} (source has ${lines.length} line${lines.length === 1 ? "" : "s"}).`,
        details: { filePath: resolved, line, totalLines: lines.length },
      });
    }

    const targetLine = lines[line - 1] ?? "";
    const indent = leadingIndent(targetLine);
    const pragmaText = formatPragma(shape, ruleId, reason);
    const inserted = `${indent}${pragmaText}`;

    // Splice the new line at index `line - 1` so the pragma lands
    // directly above the target line. `Array.splice` preserves every
    // other line untouched; the file's existing EOL is implicit in the
    // join below (we split on `\n` and rejoin on `\n`, so CRLF inputs
    // keep their `\r`s inside each line).
    lines.splice(line - 1, 0, inserted);
    const newSource = lines.join("\n");

    try {
      await writeFile(resolved, newSource, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult({
        code: "file-write-failed",
        message: `Failed to write ${resolved}: ${message}`,
        details: { filePath: resolved, cause: message },
      });
    }

    return textResult({
      applied: true,
      file: resolved,
      line,
      pragma: pragmaText,
      insertedLine: line,
      commentKind: shape.kind,
      meta: {
        cwd,
        relativeFilePath: relative(cwd, resolved),
        ruleId,
        reason,
      },
      nextStep: `Pragma written above line ${line} in ${resolved}. Re-run \`scan_file\` on ${resolved} to confirm the finding no longer fires, then commit the change with the reason captured in the commit message as well for durable audit.`,
    });
  },
};

interface PreflightOk {
  readonly resolved: string;
  readonly cwd: string;
  readonly line: number;
  readonly ruleId: string;
  readonly reason: string;
  readonly shape: PragmaShape;
  readonly source: string;
}

type PreflightResult = PreflightOk | { readonly error: McpToolResult };

/**
 * Collapses every guard (allowWrite → required params → path escape
 * → extension → file existence → read) into one discriminated union
 * so the handler early-returns via a single `if ("error" in pre)`
 * check. Mirrors the preflight shape apply_fix uses so both mutating
 * tools have the same validation silhouette.
 *
 * Line-past-EOF is NOT checked here — it needs the parsed line count,
 * and returning the source lets the caller compute that without a
 * second read. The remaining guard in the handler is cheap.
 */
async function preflight(
  params: Record<string, unknown>,
  session: McpSession,
): Promise<PreflightResult> {
  if (!session.config.allowWrite) {
    return {
      error: errorResult({
        code: "allow-write-disabled",
        message:
          "suppress is disabled: session `allowWrite` flag is false. Call `sessionConfigure` with `{ allowWrite: true }` to enable write access for this session, then retry. The flag is per-session and off by default so no ra11y tool mutates source without explicit host opt-in.",
        remediation: "Call `sessionConfigure` with `{ allowWrite: true }`, then retry suppress.",
      }),
    };
  }
  const paramGuard = readRequiredStringParams(params);
  if ("error" in paramGuard) return paramGuard;
  const { file, ruleId, reason } = paramGuard;
  const lineRaw = params["line"];
  if (typeof lineRaw !== "number" || !Number.isInteger(lineRaw) || lineRaw < 1) {
    return {
      error: errorResult({
        code: "invalid-param",
        message: "line must be a positive integer (1-based).",
        details: { param: "line", received: lineRaw },
      }),
    };
  }
  const cwd = strParam(params, "cwd") ?? process.cwd();
  const resolved = resolveInsideCwd(file, cwd);
  if (resolved === null) {
    return {
      error: errorResult({
        code: "path-escapes-cwd",
        message: `file '${file}' escapes cwd '${cwd}'. Every writable path must resolve inside the scan root.`,
        details: { file, cwd },
      }),
    };
  }
  const shape = shapeForExtension(resolved);
  if (shape === null) {
    return {
      error: errorResult({
        code: "file-unsupported",
        message: `Unsupported file extension for ${resolved}. suppress handles .tsx/.jsx, .ts/.js, .html/.htm, and .css only.`,
        details: { filePath: resolved },
      }),
    };
  }
  if (!(await fileExists(resolved))) {
    return {
      error: errorResult({
        code: "file-not-found",
        message: `File not found: ${resolved}`,
        details: { filePath: resolved },
        remediation:
          "Pass a `file` that exists on disk. Relative paths resolve from `cwd` (defaults to the MCP server's spawn directory).",
      }),
    };
  }
  let source: string;
  try {
    source = await readFile(resolved, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: errorResult({
        code: "file-read-failed",
        message: `Failed to read ${resolved}: ${message}`,
        details: { filePath: resolved, cause: message },
      }),
    };
  }
  return { resolved, cwd, line: lineRaw, ruleId, reason, shape, source };
}

interface ReadParamsOk {
  readonly file: string;
  readonly ruleId: string;
  readonly reason: string;
}

/**
 * Reads + validates the three required string params (`file`,
 * `ruleId`, `reason`). Empty / whitespace-only `reason` rejects with
 * `reason-required` per Q2-REASON; missing `file` / `ruleId` reject
 * with `missing-required-param`. Split from `preflight` so that
 * helper stays under the cognitive-complexity budget.
 */
function readRequiredStringParams(
  params: Record<string, unknown>,
): ReadParamsOk | { readonly error: McpToolResult } {
  const file = strParam(params, "file");
  if (file === undefined || file.length === 0) {
    return {
      error: errorResult({
        code: "missing-required-param",
        message: "file is required and must be a non-empty string.",
        details: { param: "file" },
      }),
    };
  }
  const ruleId = strParam(params, "ruleId");
  if (ruleId === undefined || ruleId.length === 0) {
    return {
      error: errorResult({
        code: "missing-required-param",
        message: "ruleId is required and must be a non-empty string.",
        details: { param: "ruleId" },
      }),
    };
  }
  const reasonRaw = params["reason"];
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (reason.length === 0) {
    return {
      error: errorResult({
        code: REASON_REQUIRED,
        message:
          "reason is required and must be a non-empty string. A suppression without a stated reason is a silent promise the agent can't honor — describe why this finding is a false positive, intentional, or out-of-scope.",
        details: { param: "reason" },
        remediation:
          "Re-call `suppress` with a reason that explains why the suppression is correct (e.g. 'decorative brand mark; rendered alt empty by design').",
      }),
    };
  }
  return { file, ruleId, reason };
}

/**
 * Resolves `file` against `cwd` and returns the absolute path only
 * when it stays inside the scan root. Null on any traversal attempt:
 * absolute paths outside cwd, or relative paths that climb out via
 * `..`. Mirrors the guard in `tool-apply-fix-internals.ts`.
 */
function resolveInsideCwd(file: string, cwd: string): string | null {
  const absCwd = isAbsolute(cwd) ? cwd : resolve(process.cwd(), cwd);
  const abs = isAbsolute(file) ? file : resolve(absCwd, file);
  const rel = relative(absCwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

/**
 * Pragma shape lookup keyed on the file's extension (case-insensitive).
 * Null when the extension isn't one of the four supported comment
 * contexts — `file-unsupported` is the caller's error envelope.
 */
function shapeForExtension(filePath: string): PragmaShape | null {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = lower.slice(dot);
  return EXT_SHAPES[ext] ?? null;
}

/**
 * Returns the whitespace prefix of `line`. Reused to indent the
 * inserted pragma so it visually groups with the code it suppresses
 * — a pragma at column 0 above an indented JSX return would be
 * syntactically valid but read as disconnected.
 */
function leadingIndent(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : "";
}

/**
 * Builds the pragma text for a given shape, rule ID, and reason. The
 * `: <reason>` separator is the canonical one `parseInlineDisables`
 * already honors (alongside `--`); we pick the colon form because it
 * reads most cleanly in comments and matches the shape `suppressWith`
 * emits on violation records.
 */
function formatPragma(shape: PragmaShape, ruleId: string, reason: string): string {
  return `${shape.open}${PRAGMA_DIRECTIVE} ${ruleId}: ${reason}${shape.close}`;
}

/**
 * True when `path` names an existing file (or symlink-to-file). A
 * directory at the target path returns false — we refuse to write into
 * something that isn't a regular file. ENOENT / permission errors
 * collapse to false so the caller sees a single `file-not-found`
 * envelope instead of branching on every fs error code.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}
