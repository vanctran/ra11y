/**
 * Test helper: runs a rule end-to-end against a source string.
 *
 * Used by unit tests that want to exercise a rule's check() logic
 * without spinning up a full scan. Parses the source with the right
 * parser for the extension, builds a RuleContext, calls check(),
 * and returns the emitted violations (shaped like real ScanResult
 * violations with ruleId and criteria stamped in).
 */

import { describeNodeShape, findTargetNodeAtLocation } from "../../src/engine/ast-helpers.ts";
import { buildContext } from "../../src/engine/context-builder.ts";
import { parseCss, parseHtml, parseTsx } from "../../src/input/parsers/index.ts";
import type { Ast } from "../../src/types/ast.ts";
import type { EmittedViolation, Language, ProjectContext, Rule } from "../../src/types/rule.ts";
import type { Violation } from "../../src/types/violation.ts";
import { computeFindingId } from "../../src/utils/finding-id.ts";
import { computeGroupKey, UNKNOWN_SHAPE } from "../../src/utils/group-key.ts";

export interface RunRuleOptions {
  readonly filePath?: string;
  readonly enabledStandards?: readonly string[];
  /**
   * Wrapper component name → native element tag, mirroring
   * `LoadedConfig.nativeWrapperElements`. Rules opted in via
   * `wrapperTreatsAsElement` see the matching wrapper names on
   * `ctx.wrappersForElement` when this is set.
   */
  readonly nativeWrapperElements?: Readonly<Record<string, string>>;
}

export function runRule(
  rule: Rule,
  source: string,
  options: RunRuleOptions = {},
): readonly Violation[] {
  const filePath = options.filePath ?? guessFilePath(source);
  const ast = parseSource(filePath, source);
  const sink: EmittedViolation[] = [];
  const ctx = buildContext(
    {
      filePath,
      source,
      ast,
      enabledStandards: new Set(options.enabledStandards ?? ["wcag22", "wcag21"]),
      disableMap: new Map(),
      ...(options.nativeWrapperElements !== undefined && {
        nativeWrapperElements: options.nativeWrapperElements,
      }),
    },
    sink,
    rule.wrapperTreatsAsElement,
  );
  invokeLifecycle(rule, ctx, ast, filePath, source, sink);
  return sink.map((v) => shapeViolation(rule, v, filePath, source, ast));
}

/** Mirrors the engine's rule-runner lifecycle, plus a single-file afterProject pass. */
function invokeLifecycle(
  rule: Rule,
  ctx: ReturnType<typeof buildContext>,
  ast: Ast,
  filePath: string,
  source: string,
  sink: EmittedViolation[],
): void {
  const fileCtx = { ...ctx, nodes: ast.root };
  rule.beforeFile?.(fileCtx);
  collectReturn(rule.check?.(ctx), sink);
  collectReturn(rule.afterFile?.(fileCtx), sink);
  if (!rule.afterProject) return;
  const projectCtx: ProjectContext = {
    files: [
      {
        filePath,
        source,
        ast: ast.root,
        language: ast.language as Language,
        disableMap: new Map(),
      },
    ],
    enabledStandards: ctx.enabledStandards,
    nativeWrapperElements: {},
    emit: (v) => sink.push(v),
  };
  collectReturn(rule.afterProject(projectCtx), sink);
}

function collectReturn(
  maybe: readonly EmittedViolation[] | undefined,
  sink: EmittedViolation[],
): void {
  if (Array.isArray(maybe)) for (const v of maybe) sink.push(v);
}

function shapeViolation(
  rule: Rule,
  v: EmittedViolation,
  filePath: string,
  source: string,
  ast: Ast,
): Violation {
  const effectivePath = v.location.filePath || filePath;
  const findingId = computeFindingId({
    ruleId: rule.id,
    filePath: effectivePath,
    source,
    line: v.location.line,
  });
  const node = findTargetNodeAtLocation(ast.root, v.location.line, v.location.column);
  const shape = node ? describeNodeShape(node) : UNKNOWN_SHAPE;
  const groupKey = computeGroupKey({ ruleId: rule.id, shape });
  return {
    ruleId: rule.id,
    fixClass: rule.fixClass,
    criteria: [...rule.satisfies],
    // No standards registry in this test helper path — fall back to the
    // criterion ID for every title (matches `titlesForCriteria`'s
    // "unresolved → ID" contract without pulling the registry in here).
    criteriaTitles: [...rule.satisfies],
    severity: v.severity,
    // Project-scope emitters set filePath themselves; per-file paths fall through.
    location: { ...v.location, filePath: effectivePath },
    message: v.message,
    findingId,
    groupKey,
    ...(v.suggestion !== undefined && { suggestion: v.suggestion }),
    ...(v.fix !== undefined && { fix: v.fix }),
    ...(v.fixPaths !== undefined && { fixPaths: v.fixPaths }),
    ...(v.snippet !== undefined && { snippet: v.snippet }),
    ...(v.couldBeWrongBecause && v.couldBeWrongBecause.length > 0
      ? { couldBeWrongBecause: v.couldBeWrongBecause }
      : {}),
  };
}

function guessFilePath(source: string): string {
  // Heuristic: if it looks like JSX/TS, default to .tsx; otherwise .html.
  if (/=\s*</.test(source) || /\bconst\b|\blet\b|\bfunction\b/.test(source)) return "input.tsx";
  return "input.html";
}

function parseSource(filePath: string, source: string): Ast {
  if (filePath.endsWith(".html") || filePath.endsWith(".htm")) {
    const result = parseHtml(source);
    return { language: "html", root: result.root, errors: result.errors };
  }
  if (filePath.endsWith(".css")) {
    const result = parseCss(source);
    return { language: "css", root: result.root, errors: result.errors };
  }
  const result = parseTsx(source);
  return { language: "tsx", root: result.root, errors: result.errors };
}
