/**
 * Types for the Rules layer of ra11y's three-layer model.
 *
 * A {@link Rule} is a pure function `(ctx) => Violation[]` that checks one
 * or more accessibility criteria. Rules are content, not engine code — they
 * live in `src/rules/` and declare their coverage via `satisfies: string[]`
 * (criterion IDs). The engine filters active rules by enabled standards
 * and runs them in a single AST pass per file.
 *
 * See docs/kb/architecture/rule-engine.md.
 */

import type { Severity, Violation } from "./violation.ts";

/** Supported source languages. Rules narrow their scope via `appliesTo`. */
export type Language = "tsx" | "jsx" | "ts" | "js" | "html" | "css";

/** Rule execution scope — when the engine calls the rule. */
export type RuleScope =
  /** Called once per matching AST node during the walk (default). */
  | "node"
  /** Called once per file, after the node walk, with full AST access. */
  | "document"
  /** Called once after all files are processed, with aggregate state. */
  | "project";

/**
 * How the findings from a rule get resolved. Stamped onto every
 * Violation so agents can batch-route at scan time without round-tripping
 * through `suggest_fix`. See docs/adr/0007-violation-fix-class-metadata.md.
 *
 * - `"mechanical"` — deterministic source transform (missing alt text →
 *   insert `alt`; missing lang → add `lang`; typo in an aria attribute →
 *   replace with the correct spelling). Safe to batch-apply via Edit.
 * - `"guidance"` — the fix requires judgment the scanner can't make
 *   (contrast ratios, copy rewrites, restructure decisions). Prose only.
 * - `"runtime-only"` — the scanner flags a pattern but only runtime
 *   verification (axe-core in Playwright/Vitest, manual QA) can decide.
 *   Route these to the runtime harness, not to the edit queue.
 * - `"verify-in-source"` — the agent has to read adjacent code to
 *   decide what the right fix is (keyboard handler on the parent?
 *   nested-interactive fixup requires DOM surgery? list-structure
 *   needs re-nesting?). Point the agent at the file.
 *
 * Distinct from `suggest_fix`'s response-level `kind: "edit" |
 * "guidance"` discriminator — that one describes what the suggest_fix
 * payload *contains*, while `FixClass` describes the *nature* of the
 * fix the rule demands.
 */
export type FixClass = "mechanical" | "guidance" | "runtime-only" | "verify-in-source";

/** Preconditions the engine uses to cheaply skip rules that can't apply. */
export interface AppliesTo {
  /** Node-type selectors (e.g., `JSXElement:img`, `HTMLElement:video`). */
  readonly nodeTypes?: readonly string[];
  /** File extensions (e.g., `.tsx`, `.html`, `.css`). */
  readonly fileExtensions?: readonly string[];
  /** Skip files with no `className` / `class` usage. */
  readonly requiresClassName?: boolean;
}

/** Rich, displayed-to-users metadata for each rule. */
export interface RuleDocs {
  readonly description: string;
  readonly rationale: string;
  readonly goodExample: string;
  readonly badExample: string;
  readonly normativeQuote?: string;
  readonly references: readonly string[];
}

/** The executable accessibility check. */
export interface Rule {
  readonly id: string;
  /** Criterion IDs this rule satisfies across all known standards. */
  readonly satisfies: readonly string[];
  readonly severity: Severity;
  readonly scope: RuleScope;
  /**
   * The remediation lane every finding from this rule routes into.
   * See {@link FixClass}. Required — the engine stamps this onto every
   * emitted Violation so agents can batch-route findings without a
   * per-finding round-trip through `suggest_fix`.
   */
  readonly fixClass: FixClass;
  readonly appliesTo?: AppliesTo;
  readonly docs: RuleDocs;
  /** Optional rename/alias path — see semver policy. */
  readonly deprecatedBy?: string;
  /**
   * Opt-in: the native HTML tag this rule's JSX checks care about (`"a"`,
   * `"img"`, `"input"`, …). When set, the engine exposes
   * {@link RuleContext.wrappersForElement} — the set of wrapper component
   * names whose `LoadedConfig.nativeWrapperElements` mapping targets this
   * tag. The rule iterates those names alongside the native tag so a
   * declared `<Link>`-renders-`<a>` wrapper runs through the same
   * link-text check as a bare `<a>`. Non-element-dependent rules leave
   * the field unset and keep ignoring the map.
   */
  readonly wrapperTreatsAsElement?: string;
  /** Called once per applicable file before the node walk. Optional. */
  beforeFile?(ctx: FileContext): void;
  /** Node-scoped check — called for every matching node. */
  check?(ctx: RuleContext): readonly Violation[] | undefined;
  /** Document-scoped check — called after the walk with full AST. */
  afterFile?(ctx: FileContext): readonly Violation[] | undefined;
  /** Project-scoped check — called once at end of scan. */
  afterProject?(ctx: ProjectContext): readonly Violation[] | undefined;
}

/** The type the rule author sees inside `check()`. */
export interface RuleContext {
  readonly filePath: string;
  readonly source: string;
  readonly language: Language;
  readonly ast: unknown; // narrowed by language in ast-helpers
  readonly enabledStandards: ReadonlySet<string>;
  /**
   * PascalCase component names the rule should treat as its opted-in
   * native element (via {@link Rule.wrapperTreatsAsElement}). Derived from
   * `LoadedConfig.nativeWrapperElements` filtered by the rule's target
   * tag. Empty set when the rule hasn't opted in, when no config was
   * supplied, or when no mapped wrapper renders this rule's tag.
   */
  readonly wrappersForElement: ReadonlySet<string>;
  /** Emit a violation without specifying ruleId/criteria — the engine fills them in. */
  emit(violation: EmittedViolation): void;
  /** Is the given (line, ruleId) suppressed by an inline disable pragma? */
  isDisabled(line: number, ruleId: string): boolean;
}

/** The type beforeFile/afterFile see — whole-file access. */
export interface FileContext extends RuleContext {
  readonly nodes: unknown; // full file AST
}

/**
 * The minimal per-file record a project-scoped rule sees. Already-parsed
 * material from the scanner's per-file pass — project rules MUST NOT
 * re-parse. Parallel to `ProjectFile` in review.ts.
 */
export interface ProjectRuleFile {
  readonly filePath: string;
  readonly source: string;
  readonly ast: unknown;
  readonly language: Language;
  readonly disableMap: ReadonlyMap<number, ReadonlySet<string>>;
}

/**
 * Context for cross-file rules (e.g. `focus/outline-visible`'s Tailwind
 * cross-reference). Emitted violations MUST include `location.filePath`
 * — the engine stamps `ruleId`/`criteria` but can't guess which file.
 */
export interface ProjectContext {
  readonly files: ReadonlyArray<ProjectRuleFile>;
  readonly enabledStandards: ReadonlySet<string>;
  emit(violation: EmittedViolation): void;
}

/**
 * What a rule returns via `ctx.emit()`. The engine owns `ruleId`,
 * `criteria`, `findingId`, `groupKey`, and `fixClass` — rules don't
 * know those. `findingId` is derived from the stamped ruleId + relative
 * filePath + source-context window, so it can only be computed after
 * the engine has attached the filePath to the emitted location.
 * `groupKey` is derived from the stamped ruleId + the normalized AST
 * shape the engine resolves from the emitted location (see
 * docs/adr/0008-violation-group-key.md). `fixClass` is a Rule-level
 * property (see docs/adr/0007-violation-fix-class-metadata.md), stamped
 * onto every Violation at emit time.
 */
export type EmittedViolation = Omit<
  Violation,
  "ruleId" | "criteria" | "findingId" | "groupKey" | "fixClass"
>;
