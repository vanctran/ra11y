/**
 * Types for ra11y configuration.
 *
 * Users configure ra11y via `ra11y.config.ts` at the repo root (or via
 * CLI flags, which override the file). The loader resolves the file,
 * validates its shape against these types, and produces a {@link LoadedConfig}
 * that the engine consumes.
 *
 * Configuration precedence (highest wins):
 *   1. CLI flags
 *   2. Environment variables (RA11Y_STANDARD, RA11Y_LEVEL, RA11Y_CONFIG, …)
 *   3. Config file (ra11y.config.ts / .js / .json)
 *   4. Per-project entry matching cwd (monorepo support)
 *   5. Built-in defaults
 */

import type { Severity } from "./violation.ts";
import type { Standard } from "./standard.ts";

/** Rule-level severity override. `"off"` disables the rule entirely. */
export type RuleSetting = Severity | "off";

/** Per-directory override (same shape as ESLint's overrides). */
export interface ConfigOverride {
  readonly files: readonly string[];
  readonly rules?: Readonly<Record<string, RuleSetting>>;
}

/** One project inside a monorepo — workspace-style runs. */
export interface ProjectConfig {
  readonly name: string;
  readonly path: string;
  readonly extends?: string;
  readonly standards?: readonly string[];
  readonly rules?: Readonly<Record<string, RuleSetting>>;
}

/** The user-facing config shape (what `defineConfig` accepts). */
export interface Config {
  /** Standard IDs or Standard objects to enforce. Default: `["wcag22"]`. */
  readonly standards?: ReadonlyArray<string | Standard>;
  /** Conformance level within standards (`A`, `AA`, `AAA`). Default: `"AA"`. */
  readonly level?: "A" | "AA" | "AAA";
  /** Rule-level settings. */
  readonly rules?: Readonly<Record<string, RuleSetting>>;
  /** Glob patterns to exclude from scanning. */
  readonly exclude?: readonly string[];
  /** Per-directory overrides (last match wins). */
  readonly overrides?: readonly ConfigOverride[];
  /** Monorepo/workspace projects. */
  readonly projects?: readonly ProjectConfig[];
}

/** Fully resolved config after loading, env vars, and defaults. */
export interface LoadedConfig {
  readonly standards: readonly string[];
  readonly level: "A" | "AA" | "AAA";
  readonly rules: Readonly<Record<string, RuleSetting>>;
  readonly exclude: readonly string[];
  readonly overrides: readonly ConfigOverride[];
  readonly projects: readonly ProjectConfig[];
  readonly sourcePath: string | null;
}
