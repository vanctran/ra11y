/**
 * Synthesizer for inherited findings (Q2R2-INHERITED).
 *
 * When a finding fires at a wrapper DEFINITION file — declared via
 * `LoadedConfig.nativeWrapperElements` — every call site of that wrapper
 * in the scanned files is affected by the same defect even though no
 * rule fires there directly. This post-pass emits one additional
 * Violation per `(origin finding, call site)` pair, stamped with
 * `confidence: "inherited"` + `sourceOfFinding` pointing at the origin.
 *
 * Discipline (per ADR 0012 and CLAUDE.md §1):
 *
 *   - `nativeWrapperElements` is the source of truth; wrappers outside
 *     the config map don't attribute through, even when introspection
 *     would match a basename.
 *   - Bounded by the scan's parsed files; no transitive import-graph
 *     crawl. Definition file outside scope → honest "no evidence."
 *   - Surface, don't suppress: every call site in scope is emitted. No
 *     top-N cap.
 *   - Skip `wrapper/drift` findings (the definition is the one place to
 *     fix drift) and findings that already carry `sourceOfFinding` (no
 *     chain recursion through nested wrappers).
 */

import type { Ast, JsxElement, TsxModule } from "../types/ast.ts";
import type { Violation } from "../types/violation.ts";
import { computeFindingId } from "../utils/finding-id.ts";
import { computeGroupKey, UNKNOWN_SHAPE } from "../utils/group-key.ts";
import { describeNodeShape, findTargetNodeAtLocation } from "./ast-helpers.ts";
import {
  componentNameFromPath,
  indexFilesByComponentName,
  type ProbeFile,
} from "./wrapper-probe.ts";

/** File shape the synthesizer needs — a subset of `ParsedFile`. */
export interface InheritFile {
  readonly filePath: string;
  readonly source: string;
  readonly ast: Ast;
}

export interface SynthesizeInheritedInputs {
  readonly violations: readonly Violation[];
  readonly files: readonly InheritFile[];
  readonly nativeWrapperElements: Readonly<Record<string, string>>;
}

/**
 * Produces the inherited violation list. Pure function over its
 * inputs; no I/O. Caller concatenates the result with the original
 * violations and sorts — this function does not re-sort.
 */
export function synthesizeInheritedFindings(inputs: SynthesizeInheritedInputs): Violation[] {
  const declaredNames = Object.keys(inputs.nativeWrapperElements);
  if (declaredNames.length === 0) return [];

  const definitionPathToName = resolveDefinitionPaths(inputs.files, declaredNames);
  if (definitionPathToName.size === 0) return [];

  const callSitesByWrapper = collectCallSites(inputs.files, new Set(definitionPathToName.values()));
  const fileByPath = new Map<string, InheritFile>();
  for (const f of inputs.files) fileByPath.set(f.filePath, f);

  const out: Violation[] = [];
  for (const v of inputs.violations) {
    emitInheritedFor(v, definitionPathToName, callSitesByWrapper, fileByPath, out);
  }
  return out;
}

function resolveDefinitionPaths(
  files: readonly InheritFile[],
  declaredNames: readonly string[],
): Map<string, string> {
  const probeFiles: ProbeFile[] = files
    .filter((f) => isJsxLike(f.ast))
    .map((f) => ({ filePath: f.filePath, language: f.ast.language, root: f.ast.root }));
  const byName = indexFilesByComponentName(probeFiles);
  const out = new Map<string, string>();
  for (const name of declaredNames) {
    const probe = byName.get(name);
    if (probe) out.set(probe.filePath, name);
  }
  return out;
}

function emitInheritedFor(
  v: Violation,
  definitionPathToName: ReadonlyMap<string, string>,
  callSitesByWrapper: ReadonlyMap<string, readonly CallSite[]>,
  fileByPath: ReadonlyMap<string, InheritFile>,
  out: Violation[],
): void {
  if (!shouldInherit(v)) return;
  const wrapperName = definitionPathToName.get(v.location.filePath);
  if (wrapperName === undefined) return;
  const callSites = callSitesByWrapper.get(wrapperName);
  if (!callSites || callSites.length === 0) return;
  for (const site of callSites) out.push(buildInheritedViolation(v, site, wrapperName, fileByPath));
}

/** Inheritable = not `wrapper/drift`, not a rule crash, not already inherited. */
function shouldInherit(v: Violation): boolean {
  if (v.ruleId === "wrapper/drift") return false;
  if (v.sourceOfFinding !== undefined) return false;
  if (v.ruleId === "internal/rule-crash") return false;
  return true;
}

function isJsxLike(
  ast: Ast,
): ast is Ast & { readonly language: "tsx" | "jsx" | "ts" | "js"; readonly root: TsxModule } {
  const l = ast.language;
  return l === "tsx" || l === "jsx" || l === "ts" || l === "js";
}

interface CallSite {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Records each `<WrapperName …>` call site across parsed JSX/TSX
 * files, keyed by wrapper name (sorted by path then line/column).
 * Self-renders in the wrapper's own definition file are skipped —
 * redundant with the primary finding which already lives there.
 */
function collectCallSites(
  files: readonly InheritFile[],
  wrapperNames: ReadonlySet<string>,
): Map<string, CallSite[]> {
  const out = new Map<string, CallSite[]>();
  for (const name of wrapperNames) out.set(name, []);
  for (const f of files) appendCallSitesForFile(f, out);
  for (const list of out.values()) list.sort(compareCallSites);
  return out;
}

function appendCallSitesForFile(f: InheritFile, out: Map<string, CallSite[]>): void {
  if (!isJsxLike(f.ast)) return;
  // Skip the wrapper's own definition file — a self-render is either
  // the component signature line (a false call site) or a recursive
  // internal reference; inheriting at the same file the primary
  // finding already lives in is redundant noise.
  const ownName = componentNameFromPath(f.filePath);
  for (const el of walkJsx(f.ast.root)) {
    const tag = el.tagName;
    if (tag === ownName) continue;
    const list = out.get(tag);
    if (!list) continue;
    list.push({ filePath: f.filePath, line: el.loc.start.line, column: el.loc.start.column });
  }
}

function compareCallSites(a: CallSite, b: CallSite): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

function* walkJsx(module: TsxModule): Iterable<JsxElement> {
  for (const el of module.jsxElements) {
    yield el;
    yield* walkChildren(el);
  }
}

function* walkChildren(element: JsxElement): Iterable<JsxElement> {
  for (const child of element.children) {
    if (child.kind === "JsxElement") {
      yield child;
      yield* walkChildren(child);
    }
  }
}

/**
 * Stamps a fresh inherited Violation for one (origin finding, call
 * site) pair. Fix / fixPaths are deliberately NOT carried: the edit
 * belongs at the wrapper definition, not at the call site.
 */
function buildInheritedViolation(
  source: Violation,
  site: CallSite,
  wrapperName: string,
  fileByPath: ReadonlyMap<string, InheritFile>,
): Violation {
  const file = fileByPath.get(site.filePath);
  const shape = resolveShape(file?.ast, site.line, site.column);
  const findingId = computeFindingId({
    ruleId: source.ruleId,
    filePath: site.filePath,
    source: file?.source ?? "",
    line: site.line,
  });
  const groupKey = computeGroupKey({ ruleId: source.ruleId, shape });
  return {
    ruleId: source.ruleId,
    fixClass: source.fixClass,
    criteria: source.criteria,
    ...(source.criteriaTitles !== undefined && { criteriaTitles: source.criteriaTitles }),
    severity: source.severity,
    location: { filePath: site.filePath, line: site.line, column: site.column },
    message: `[inherited from <${wrapperName}>] ${source.message}`,
    ...(source.suggestion !== undefined && { suggestion: source.suggestion }),
    confidence: "inherited",
    sourceOfFinding: {
      filePath: source.location.filePath,
      line: source.location.line,
      ...(source.location.column !== undefined && { column: source.location.column }),
    },
    findingId,
    groupKey,
    ...(source.couldBeWrongBecause && source.couldBeWrongBecause.length > 0
      ? { couldBeWrongBecause: source.couldBeWrongBecause }
      : {}),
  };
}

function resolveShape(ast: Ast | undefined, line: number, column: number): string {
  if (!ast) return UNKNOWN_SHAPE;
  const node = findTargetNodeAtLocation(ast.root, line, column);
  return node ? describeNodeShape(node) : UNKNOWN_SHAPE;
}
