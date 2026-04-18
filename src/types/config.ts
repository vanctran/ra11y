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

import type { Standard } from "./standard.ts";
import type { Severity } from "./violation.ts";

/** Rule-level severity override. `"off"` disables the rule entirely. */
export type RuleSetting = Severity | "off";

/** Per-directory override (same shape as ESLint's overrides). */
export interface ConfigOverride {
  readonly files: readonly string[];
  readonly rules?: Readonly<Record<string, RuleSetting>>;
}

/**
 * Nested mapping of wrapper component name → native element. Enables
 * compound components (`<Card.Header>`, `<Composer.SendButton>`) — each
 * nested level becomes a segment of the component's dotted JSX tag name.
 *
 * A leaf value is the native element the wrapper renders (`"div"`,
 * `"button"`, `"a"`). A nested object maps further subcomponents of
 * that namespace:
 *
 *     { Card: { Header: "div", Body: "div" }, Composer: { SendButton: "button" } }
 *
 * flattens to the dotted names `Card.Header`, `Card.Body`,
 * `Composer.SendButton` — exactly what the TSX parser produces for
 * `<Card.Header>` (tag name includes the dot). Arbitrary nesting depth
 * is supported; each segment may itself be a glob pattern (`*Section`)
 * following the same rules as the flat object form.
 */
export interface NativeWrapperMap {
  readonly [name: string]: string | NativeWrapperMap;
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
  /**
   * PascalCase components this project has verified wrap a native interactive
   * element (`<button>`, `<a>`, etc.). Rules like `keyboard/handler-missing`
   * use this list to skip emitting low-confidence info notes on them.
   * Project-level acknowledgment that replaces sprinkling inline pragmas at
   * every call site.
   *
   * Three accepted shapes:
   *   - `string[]` — `["Button", "ActionButton", "IconButton"]`. Opaque
   *     names; rules only know "skip this, it's a wrapper." Legacy shape,
   *     still the most common.
   *   - `Record<string, string>` — `{ Button: "button", Link: "a", Image:
   *     "img" }`. Names mapped to the native element they render. Rules
   *     that depend on the underlying semantics (link-descriptive-text on
   *     `"a"`-mapped wrappers, alt-text on `"img"`-mapped wrappers) can
   *     run through the wrapper as if it were the native tag.
   *   - {@link NativeWrapperMap} — nested object form for compound
   *     components: `{ Card: { Header: "div", Body: "div" }, Composer:
   *     { SendButton: "button" } }`. Nested keys flatten to dotted
   *     paths (`Card.Header`, `Composer.SendButton`) matching the JSX
   *     tag names the TSX parser emits for `<Card.Header>` call sites.
   *     Leaves and nested maps may be freely mixed at any level
   *     (`{ Button: "button", Card: { Header: "div" } }`).
   *
   * All shapes produce the same `LoadedConfig.nativeWrappers: string[]`
   * for existing consumers. The object/nested forms also populate
   * `LoadedConfig.nativeWrapperElements: Record<string, string>` — new,
   * optional, consumed only by rules that opt in.
   */
  readonly nativeWrappers?: readonly string[] | Readonly<Record<string, string>> | NativeWrapperMap;
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
  readonly nativeWrappers: readonly string[];
  /**
   * Optional mapping from wrapper component name to the native element
   * it renders (`{ Button: "button", Link: "a" }`). Populated only when
   * the user supplied the object form of `Config.nativeWrappers`. Rules
   * that consume element semantics (link-purpose, alt-text) can opt
   * into running through wrappers by consulting this map; rules that
   * only need "skip this, it's a wrapper" keep reading `nativeWrappers`.
   *
   * Empty object when the user supplied the string-array form — absence
   * of a mapping is the signal that the wrappers are opaque.
   */
  readonly nativeWrapperElements: Readonly<Record<string, string>>;
  readonly overrides: readonly ConfigOverride[];
  readonly projects: readonly ProjectConfig[];
  readonly sourcePath: string | null;
}
