/**
 * Test helper: runs a candidate finder against a source string.
 *
 * Structurally parallel to run-rule.ts but returns ReviewCandidate[]
 * instead of Violation[].
 */

import { buildContext } from "../../src/engine/context-builder.ts";
import { parseCss, parseHtml, parseTsx } from "../../src/input/parsers/index.ts";
import type { Ast } from "../../src/types/ast.ts";
import type { CandidateFinder, ReviewCandidate } from "../../src/types/review.ts";
import type { EmittedViolation } from "../../src/types/rule.ts";

export interface RunFinderOptions {
  readonly filePath?: string;
  readonly enabledStandards?: readonly string[];
}

export function runFinder(
  finder: CandidateFinder,
  source: string,
  options: RunFinderOptions = {},
): readonly ReviewCandidate[] {
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

  if (finder.find) {
    return finder.find(ctx) ?? [];
  }
  if (finder.afterFile) {
    const fileCtx = { ...ctx, nodes: ast.root };
    return finder.afterFile(fileCtx) ?? [];
  }
  return [];
}

function guessFilePath(source: string): string {
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
