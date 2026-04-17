/**
 * Test helper: runs a rule end-to-end against a source string.
 *
 * Used by unit tests that want to exercise a rule's check() logic
 * without spinning up a full scan. Parses the source with the right
 * parser for the extension, builds a RuleContext, calls check(),
 * and returns the emitted violations (shaped like real ScanResult
 * violations with ruleId and criteria stamped in).
 */

import { buildContext } from "../../src/engine/context-builder.ts";
import { parseCss, parseHtml, parseTsx } from "../../src/input/parsers/index.ts";
import type { Ast } from "../../src/types/ast.ts";
import type { EmittedViolation, Language, ProjectContext, Rule } from "../../src/types/rule.ts";
import type { Violation } from "../../src/types/violation.ts";

export interface RunRuleOptions {
  readonly filePath?: string;
  readonly enabledStandards?: readonly string[];
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
    },
    sink,
  );
  invokeLifecycle(rule, ctx, ast, filePath, source, sink);
  return sink.map((v) => shapeViolation(rule, v, filePath));
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

function shapeViolation(rule: Rule, v: EmittedViolation, filePath: string): Violation {
  return {
    ruleId: rule.id,
    criteria: [...rule.satisfies],
    severity: v.severity,
    // Project-scope emitters set filePath themselves; per-file paths fall through.
    location: { ...v.location, filePath: v.location.filePath || filePath },
    message: v.message,
    ...(v.suggestion !== undefined && { suggestion: v.suggestion }),
    ...(v.fix !== undefined && { fix: v.fix }),
    ...(v.fixPaths !== undefined && { fixPaths: v.fixPaths }),
    ...(v.snippet !== undefined && { snippet: v.snippet }),
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
