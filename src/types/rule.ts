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
  readonly appliesTo?: AppliesTo;
  readonly docs: RuleDocs;
  /** Optional rename/alias path — see semver policy. */
  readonly deprecatedBy?: string;
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
  /** Emit a violation without specifying ruleId/criteria — the engine fills them in. */
  emit(violation: EmittedViolation): void;
  /** Is the given (line, ruleId) suppressed by an inline disable pragma? */
  isDisabled(line: number, ruleId: string): boolean;
}

/** The type beforeFile/afterFile see — whole-file access. */
export interface FileContext extends RuleContext {
  readonly nodes: unknown; // full file AST
}

/** The type afterProject sees — aggregate state across all files. */
export interface ProjectContext {
  readonly files: ReadonlyArray<FileContext>;
  readonly enabledStandards: ReadonlySet<string>;
  emit(violation: Omit<Violation, never>): void;
}

/** What a rule returns via `ctx.emit()` — engine fills in ruleId + criteria. */
export type EmittedViolation = Omit<Violation, "ruleId" | "criteria">;
