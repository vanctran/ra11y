/**
 * Configuration loader.
 *
 * Resolves a user's `ra11y.config.{ts,js,json}` file walking up from
 * a starting directory, reads it, and produces a fully resolved
 * {@link LoadedConfig}. Missing or malformed config files return the
 * defaults — ra11y works out of the box with no config, but honors
 * one when it's present.
 *
 * Loader precedence (highest wins):
 *   1. Explicit path passed as `configPath`
 *   2. `$RA11Y_CONFIG` environment variable
 *   3. Walk up from cwd looking for ra11y.config.ts/js/json, stopping
 *      at a .git directory or the filesystem root
 *   4. Defaults (DEFAULT_CONFIG)
 *
 * The TypeScript loading path uses Bun's native .ts import support
 * (this module is run under Bun). When shipped as a compiled
 * artifact on Node, the .ts path falls back to .js. .json is always
 * supported via JSON.parse.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  Config,
  ConfigOverride,
  ConfigPreset,
  ConformanceProfile,
  LoadedConfig,
  NativeWrapperMap,
  Process,
  RuleSetting,
} from "../types/config.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { validateProfiles } from "./schema.ts";

/**
 * Accepted `preset` values. Any other value from a user config file is
 * rejected by {@link normalizePreset} — silently-ignored-bad-input was
 * the antipattern from the opt-in config flow where a typo (`"storyBook"`)
 * would fall through to "no preset" with zero feedback. Keep this list
 * in sync with `ConfigPreset` in `src/types/config.ts`.
 */
const ACCEPTED_PRESETS: ReadonlySet<ConfigPreset> = new Set<ConfigPreset>(["storybook"]);

const CONFIG_FILENAMES = [
  "ra11y.config.ts",
  "ra11y.config.js",
  "ra11y.config.mjs",
  "ra11y.config.json",
] as const;

export interface LoadConfigOptions {
  /** Starting directory for the upward walk. Defaults to process.cwd(). */
  readonly cwd?: string;
  /** Explicit config path override. Skips discovery when provided. */
  readonly configPath?: string;
  /** Skip discovery and always return DEFAULT_CONFIG. */
  readonly skip?: boolean;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  if (options.skip === true) return DEFAULT_CONFIG;
  const cwd = options.cwd ?? process.cwd();
  const path = resolveConfigPath(cwd, options.configPath);
  if (!path) return DEFAULT_CONFIG;
  try {
    const userConfig = await readConfigFile(path);
    return mergeConfig(userConfig, path);
  } catch (err) {
    // Surface the error but fall back to defaults so a broken config
    // doesn't completely prevent ra11y from running.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ra11y: failed to load config at ${path}: ${message}\n`);
    return { ...DEFAULT_CONFIG, sourcePath: path };
  }
}

/**
 * Finds the config file by walking up from `cwd`. Returns an absolute
 * path or null if none exists.
 */
function resolveConfigPath(cwd: string, explicit: string | undefined): string | null {
  const fromExplicit = resolveFromExplicit(cwd, explicit);
  if (fromExplicit !== null) return fromExplicit;
  const fromEnv = resolveFromEnv(cwd);
  if (fromEnv !== null) return fromEnv;
  return walkUpFrom(resolve(cwd));
}

function resolveFromExplicit(cwd: string, explicit: string | undefined): string | null {
  if (explicit === undefined || explicit.length === 0) return null;
  return isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
}

function resolveFromEnv(cwd: string): string | null {
  const envPath = process.env.RA11Y_CONFIG;
  if (envPath === undefined || envPath.length === 0) return null;
  return isAbsolute(envPath) ? envPath : resolve(cwd, envPath);
}

/** Walks up from `start` looking for a known config filename. Stops at .git or the filesystem root. */
function walkUpFrom(start: string): string | null {
  let dir = start;
  while (true) {
    const found = findConfigIn(dir);
    if (found !== null) return found;
    if (existsSync(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findConfigIn(dir: string): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function readConfigFile(path: string): Promise<Config> {
  if (path.endsWith(".json")) {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Config;
  }
  // Dynamic import handles .ts (under Bun), .js, .mjs.
  const module = (await import(path)) as { default?: Config };
  if (module.default === undefined) {
    throw new Error(`config file has no default export`);
  }
  return module.default;
}

function mergeConfig(user: Config, sourcePath: string): LoadedConfig {
  const standards = user.standards ?? DEFAULT_CONFIG.standards;
  const standardsAsStrings: readonly string[] = standards.map((s) =>
    typeof s === "string" ? s : s.id,
  );

  const rules: Readonly<Record<string, RuleSetting>> = user.rules ?? DEFAULT_CONFIG.rules;
  const exclude: readonly string[] = user.exclude ?? DEFAULT_CONFIG.exclude;
  const { nativeWrappers, nativeWrapperElements } = normalizeNativeWrappers(user.nativeWrappers);
  const overrides: readonly ConfigOverride[] = user.overrides ?? DEFAULT_CONFIG.overrides;
  const projects = user.projects ?? DEFAULT_CONFIG.projects;
  const processes = normalizeProcesses(user.processes);
  const profiles: readonly ConformanceProfile[] = validateProfiles(user.profiles);
  const preset = normalizePreset(user.preset, sourcePath);

  return {
    standards: standardsAsStrings,
    level: user.level ?? DEFAULT_CONFIG.level,
    ...(preset === undefined ? {} : { preset }),
    rules,
    exclude,
    nativeWrappers,
    nativeWrapperElements,
    overrides,
    projects,
    processes,
    profiles,
    sourcePath,
  };
}

/**
 * Validates and normalizes `Config.processes`. The primitive exists so
 * process-level WCAG criteria (3.2.3, 3.2.4, 2.4.5) have a deterministic
 * page set to evaluate against — an empty or malformed declaration is
 * worse than no declaration, because downstream coverage would silently
 * mark the criteria as clean. Every invalid shape throws; the loader's
 * outer try/catch surfaces the error to stderr and falls back to
 * defaults (`processes: []`), which in turn makes the criteria report
 * as `absent` — honest failure rather than silent partial success.
 *
 * Validations:
 *   - `name` must be a non-empty string
 *   - `name` must be unique across the process list
 *   - `pages` must be a non-empty array
 *   - every entry in `pages` must be a non-empty string
 *
 * Duplicate pages *within* a single process are not an error (ADR 0016
 * classifies that as a future validation warning) — the primitive here
 * just guarantees the shape the downstream finders can trust.
 */
function normalizeProcesses(raw: readonly Process[] | undefined): readonly Process[] {
  if (raw === undefined) return DEFAULT_CONFIG.processes;
  if (!Array.isArray(raw)) {
    throw new Error(`processes must be an array of { name, pages } entries`);
  }
  const seen = new Set<string>();
  const out: Process[] = [];
  for (let i = 0; i < raw.length; i++) {
    out.push(normalizeProcessEntry(raw[i], i, seen));
  }
  return out;
}

function normalizeProcessEntry(entry: unknown, i: number, seen: Set<string>): Process {
  if (entry === undefined || entry === null || typeof entry !== "object") {
    throw new Error(`processes[${i}] must be an object with name and pages`);
  }
  const name = (entry as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`processes[${i}].name must be a non-empty string`);
  }
  if (seen.has(name)) {
    throw new Error(`processes[${i}].name duplicates an earlier entry: ${name}`);
  }
  seen.add(name);
  const pages = validateProcessPages((entry as { pages?: unknown }).pages, i);
  return { name, pages };
}

function validateProcessPages(raw: unknown, i: number): readonly string[] {
  if (!Array.isArray(raw)) {
    throw new Error(`processes[${i}].pages must be an array of file paths`);
  }
  if (raw.length === 0) {
    throw new Error(
      `processes[${i}].pages is empty — a process with zero pages cannot run process-level criteria`,
    );
  }
  for (let j = 0; j < raw.length; j++) {
    const page = raw[j];
    if (typeof page !== "string" || page.length === 0) {
      throw new Error(`processes[${i}].pages[${j}] must be a non-empty string`);
    }
  }
  return [...raw] as readonly string[];
}

/**
 * Validates `user.preset` against {@link ACCEPTED_PRESETS}. A missing
 * value returns `undefined` (no preset engaged). An invalid value
 * writes a warning to stderr and also returns `undefined` — the
 * loader's broader "fall back, don't crash" policy — but the warning
 * makes the silently-ignored-typo failure mode observable per
 * CLAUDE.md §1 "Ambiguous field shapes are dishonest."
 */
function normalizePreset(raw: unknown, sourcePath: string): ConfigPreset | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string" && ACCEPTED_PRESETS.has(raw as ConfigPreset)) {
    return raw as ConfigPreset;
  }
  const accepted = [...ACCEPTED_PRESETS].map((p) => `"${p}"`).join(", ");
  process.stderr.write(
    `ra11y: ignoring invalid preset \`${String(raw)}\` in ${sourcePath}; accepted values: ${accepted}.\n`,
  );
  return undefined;
}

/**
 * Normalizes every accepted shape of `Config.nativeWrappers` into the
 * canonical `LoadedConfig` pair: a flat name list for existing
 * silence-on-wrapper callers, and a flat wrapper → native-element map
 * for rules that opt into mapped wrappers.
 *
 * Three input shapes collapse to the same output shape:
 *   - `["Button", "Link"]` → names only, empty element map
 *   - `{ Button: "button", Link: "a" }` → names + flat element map
 *   - `{ Card: { Header: "div" }, Composer: { SendButton: "button" } }` →
 *     nested keys flatten to dotted paths (`Card.Header`,
 *     `Composer.SendButton`) in both outputs, so `<Card.Header>` JSX
 *     call sites (whose tag names already contain the dot) silence and
 *     map identically to a flat `"Card.Header"` declaration.
 *
 * An un-supplied field falls back to the defaults' empties.
 */
function normalizeNativeWrappers(raw: readonly string[] | NativeWrapperMap | undefined): {
  readonly nativeWrappers: readonly string[];
  readonly nativeWrapperElements: Readonly<Record<string, string>>;
} {
  if (raw === undefined) {
    return {
      nativeWrappers: DEFAULT_CONFIG.nativeWrappers,
      nativeWrapperElements: DEFAULT_CONFIG.nativeWrapperElements,
    };
  }
  if (Array.isArray(raw)) {
    return { nativeWrappers: raw, nativeWrapperElements: {} };
  }
  const elements: Record<string, string> = {};
  flattenWrapperMap(raw as NativeWrapperMap, "", elements);
  const names = Object.keys(elements).sort();
  return { nativeWrappers: names, nativeWrapperElements: elements };
}

/**
 * Walks a (possibly nested) wrapper map and writes every leaf into the
 * accumulator under its dotted path. Leaf = string (the native element);
 * nested object = descend with `prefix + key + "."`. Non-string,
 * non-object values at a leaf are skipped silently — the loader's
 * fall-back-to-defaults policy applies to malformed subtrees the same
 * way it applies to a broken file.
 */
function flattenWrapperMap(
  node: NativeWrapperMap,
  prefix: string,
  out: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      out[path] = value;
    } else if (value !== null && typeof value === "object") {
      flattenWrapperMap(value as NativeWrapperMap, path, out);
    }
  }
}
