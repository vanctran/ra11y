/**
 * Test helper: runs a rule end-to-end against a source string.
 *
 * Used by unit tests that want to exercise a rule's check() logic
 * without spinning up a full scan. Parses the source with the right
 * parser for the extension, builds a RuleContext, calls check(),
 * and returns the emitted violations (shaped like real ScanResult
 * violations with ruleId and criteria stamped in).
 */

import { parseHtml, parseTsx } from "../../src/input/parsers/index.ts";
import { buildContext } from "../../src/engine/context-builder.ts";
import type { Ast } from "../../src/types/ast.ts";
import type { EmittedViolation, Rule } from "../../src/types/rule.ts";
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
  // Mirror the rule-runner lifecycle: beforeFile → check → afterFile.
  // Document-scoped rules put their logic in afterFile, and we'd
  // silently skip them if we only called check().
  const fileCtx = { ...ctx, nodes: ast.root };
  if (rule.beforeFile) {
    rule.beforeFile(fileCtx);
  }
  if (rule.check) {
    const maybe = rule.check(ctx);
    if (Array.isArray(maybe)) {
      for (const v of maybe) sink.push(v);
    }
  }
  if (rule.afterFile) {
    const maybe = rule.afterFile(fileCtx);
    if (Array.isArray(maybe)) {
      for (const v of maybe) sink.push(v);
    }
  }
  return sink.map((v) => ({
    ruleId: rule.id,
    criteria: rule.satisfies,
    severity: v.severity,
    location: { ...v.location, filePath },
    message: v.message,
    ...(v.suggestion !== undefined && { suggestion: v.suggestion }),
    ...(v.fix !== undefined && { fix: v.fix }),
    ...(v.snippet !== undefined && { snippet: v.snippet }),
  }));
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
  const result = parseTsx(source);
  return { language: "tsx", root: result.root, errors: result.errors };
}
