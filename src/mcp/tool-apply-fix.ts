/**
 * The `apply_fix` MCP tool — consume a `suggest_fix` result, apply the
 * search/replace edit, re-scan the touched file, and return the
 * before/after delta. This is the ONLY ra11y MCP tool that mutates the
 * user's source, so it's gated on the session's `allowWrite` flag: the
 * host must opt-in via `configure({ allowWrite: true })` (or the
 * `--allow-write` CLI equivalent) before any on-disk write happens.
 *
 * Edit shape matches what `suggest_fix` emits natively on `kind: "edit"`
 * — `{ oldText, newText }`. The handler requires `oldText` to appear
 * exactly once in the source so the edit can't silently misapply to a
 * near-duplicate occurrence; multiple matches surface as an error
 * envelope with the match count so the agent can add disambiguating
 * context.
 *
 * Safety layers, in order:
 *   1. `allowWrite` session flag — reject otherwise.
 *   2. Path validation — reject absolute paths outside `cwd`, reject
 *      relative paths that escape `cwd` via `..`.
 *   3. File existence — reject missing / unsupported extensions.
 *   4. Search presence + uniqueness — `oldText` must match exactly once.
 *   5. Post-edit parse — if the new contents produce parse errors the
 *      original didn't, reject and leave the file untouched. This is the
 *      last guardrail before we hand the agent a "fix" that actually
 *      broke the file.
 *   6. `dryRun: true` — compute everything in memory and return the
 *      delta, never touch the disk. Default true; the handler writes
 *      only when `dryRun === false` AND every check above passed.
 *
 * Delta is computed by fingerprint `(ruleId, filePath, message)` — the
 * same recipe `engine/baseline.ts` uses — so a fix that only changes a
 * violation's line number still reads as "resolved" correctly. Both
 * rule-level violations and review candidates are tracked; the agent
 * uses candidates to decide if the fix introduced a new manual-review
 * burden.
 *
 * Helper implementations (preflight, delta, fingerprinting, parse
 * helpers, nextStep builders) live in `tool-apply-fix-internals.ts`.
 */

import { writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { parseInlineDisables } from "../config/index.ts";
import type { ParsedFile } from "../engine/scanner.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import {
  buildNextStep,
  computeDelta,
  formatCandidate,
  formatSlice,
  parseErrorEnvelope,
  parseFor,
  preflightValidate,
  resolveLevelParam,
  runSingleFileScan,
} from "./tool-apply-fix-internals.ts";
import {
  applyRuleSettings,
  errorResult,
  formatFinding,
  type McpTool,
  type McpToolResult,
  resolveStandards,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export const applyFixTool: McpTool = {
  def: {
    name: "apply_fix",
    description:
      "Apply a `suggest_fix` edit to a single file, re-scan that file, and return the before/after delta. Consumes the `{ oldText, newText }` edit shape `suggest_fix` emits on `kind: \"edit\"` — paste `primary.edit` through directly. This is the only ra11y MCP tool that writes to disk; the session must have `allowWrite: true` (set via `configure({ allowWrite: true })`) or the call is rejected with an error envelope naming the flag.\n\nDefault behavior is NON-destructive: `dryRun: true` (default) computes the post-edit contents in memory, runs the delta scan, returns the result, and never touches disk. Flip `dryRun: false` to actually write. If the post-edit contents produce parse errors the original didn't, the write is aborted and the file is left untouched even in non-dry mode — you get a structured error naming the parse failure instead of a silently broken file.\n\n`oldText` must match exactly once in the source. Multiple matches come back as an error envelope with the match count so you can add disambiguating context from `sourceContext`; zero matches likewise surfaces so you don't silently drop the fix.\n\nThe delta uses the same `(ruleId, filePath, message)` fingerprint as the baseline tool, so a fix that changes a violation's line but not its shape still reads as \"resolved\" correctly. Both rule-level violations and review candidates are tracked — if the edit introduces a new manual-review burden, you'll see it in `delta.newCandidates`.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Path to the file the edit applies to. Absolute paths must live inside `cwd`; relative paths resolve from `cwd`. Traversal attempts (`../../etc/hosts`) are rejected.",
        },
        edit: {
          type: "object",
          description:
            "Structured edit from `suggest_fix`. Pass `primary.edit` verbatim — the shape is `{ oldText, newText }`. `oldText` must match exactly once in the source file.",
          properties: {
            oldText: {
              type: "string",
              description: "Exact text to search for. Must appear exactly once in the file.",
            },
            newText: {
              type: "string",
              description: "Replacement text. Empty string is valid for deletion-style fixes.",
            },
          },
          required: ["oldText", "newText"],
        },
        cwd: {
          type: "string",
          description:
            "Base directory for resolving `filePath` and enforcing the no-escape guard. Defaults to the MCP server's spawn directory; pass your project root explicitly when the server's cwd differs.",
        },
        standard: {
          type: "string",
          description: "Standard ID (e.g. wcag22). Defaults to session config.",
        },
        level: {
          type: "string",
          enum: ["A", "AA", "AAA"],
          description: "Conformance level. Defaults to session config.",
        },
        dryRun: {
          type: "boolean",
          description:
            "When true (default), compute the delta from the in-memory post-edit content and never write to disk. Flip to false to actually write the file. A successful write still leaves the file untouched if the post-edit contents would produce new parse errors.",
        },
      },
      required: ["filePath", "edit"],
    },
    // The tool can mutate source when `dryRun: false`; no readOnlyHint.
    annotations: { idempotentHint: false },
  },
  async handler(params, session): Promise<McpToolResult> {
    const preflight = await preflightValidate(params, session);
    if ("error" in preflight) return preflight.error;
    const { resolved, cwd, edit, ext, original, dryRun } = preflight;

    const newSource = original.source.replace(edit.oldText, edit.newText);
    const newAst = parseFor(ext, newSource);
    const originalErrorCount = original.ast.errors.length;
    const newErrorCount = newAst.errors.length;
    if (newErrorCount > originalErrorCount) {
      return parseErrorEnvelope(resolved, newAst.errors, originalErrorCount);
    }

    const postFile: ParsedFile = {
      filePath: resolved,
      source: newSource,
      ast: newAst,
      disableMap: parseInlineDisables(newSource),
    };

    const standards = resolveStandards(strParam(params, "standard"), session);
    const projectConfig = await session.loadProjectConfig(cwd);
    const effective = session.effectiveRules(projectConfig);
    const activeRules = applyRuleSettings(BUILTIN_RULES, effective);
    const level = resolveLevelParam(strParam(params, "level"), session.config.level);

    const before = runSingleFileScan(original, activeRules, standards, level);
    const after = runSingleFileScan(postFile, activeRules, standards, level);

    let applied = false;
    if (!dryRun) {
      try {
        await writeFile(resolved, newSource, "utf8");
        applied = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Failed to write ${resolved}: ${message}`);
      }
    }

    const delta = computeDelta(before, after);

    return textResult({
      applied,
      dryRun,
      filePath: resolved,
      before: formatSlice(before),
      after: formatSlice(after),
      delta: {
        resolvedViolations: delta.resolvedViolations.map(formatFinding),
        newViolations: delta.newViolations.map(formatFinding),
        resolvedCandidates: delta.resolvedCandidates.map(formatCandidate),
        newCandidates: delta.newCandidates.map(formatCandidate),
      },
      meta: {
        cwd,
        relativeFilePath: relative(cwd, resolved),
        standards: [...standards].sort(),
        rulesEvaluated: activeRules.length,
        parseErrorsBefore: originalErrorCount,
        parseErrorsAfter: newErrorCount,
      },
      nextStep: buildNextStep({ applied, dryRun, delta, resolved }),
    });
  },
};
