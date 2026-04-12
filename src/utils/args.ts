/**
 * In-house argument parser.
 *
 * Accepts `--key value`, `--key=value`, `-k value`, `-kvalue`, and `--`
 * sentinel (everything after `--` is a positional). Boolean flags can be
 * declared in `flags` so they don't consume the next argument. Zero-dep,
 * stable ordering, deterministic.
 */

export interface ParsedArgs {
  readonly options: Readonly<Record<string, string | boolean | string[]>>;
  readonly positionals: readonly string[];
}

export interface ParseOptions {
  /** Long-form flags that never take a value (e.g., `--verbose`). */
  readonly flags?: readonly string[];
  /** Short → long aliases (e.g., `{ f: "format" }`). */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Keys that can appear multiple times and should accumulate into an array. */
  readonly repeatable?: readonly string[];
}

interface Mutable {
  readonly flags: ReadonlySet<string>;
  readonly aliases: Readonly<Record<string, string>>;
  readonly repeatable: ReadonlySet<string>;
  readonly options: Record<string, string | boolean | string[]>;
  readonly positionals: string[];
}

export function parseArgs(argv: readonly string[], opts: ParseOptions = {}): ParsedArgs {
  const state: Mutable = {
    flags: new Set(opts.flags ?? []),
    aliases: opts.aliases ?? {},
    repeatable: new Set(opts.repeatable ?? []),
    options: {},
    positionals: [],
  };

  let i = 0;
  let afterSentinel = false;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      i += 1;
      continue;
    }
    if (afterSentinel) {
      state.positionals.push(arg);
      i += 1;
      continue;
    }
    if (arg === "--") {
      afterSentinel = true;
      i += 1;
      continue;
    }
    i += consumeToken(arg, i, argv, state);
  }

  return { options: state.options, positionals: state.positionals };
}

/** Consumes one argv token and returns how many positions to advance. */
function consumeToken(arg: string, i: number, argv: readonly string[], state: Mutable): number {
  if (arg.startsWith("--")) return consumeLongOption(arg, i, argv, state);
  if (arg.startsWith("-") && arg.length > 1) return consumeShortOption(arg, i, argv, state);
  state.positionals.push(arg);
  return 1;
}

function consumeLongOption(
  arg: string,
  i: number,
  argv: readonly string[],
  state: Mutable,
): number {
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    setOption(state.options, arg.slice(2, eq), arg.slice(eq + 1), state.repeatable);
    return 1;
  }
  const key = arg.slice(2);
  return consumeFlagOrValue(key, i, argv, state);
}

function consumeShortOption(
  arg: string,
  i: number,
  argv: readonly string[],
  state: Mutable,
): number {
  const shortKey = arg[1] ?? "";
  const longKey = state.aliases[shortKey] ?? shortKey;
  if (arg.length > 2 && arg[2] !== "=") {
    setOption(state.options, longKey, arg.slice(2), state.repeatable);
    return 1;
  }
  if (arg.length > 2 && arg[2] === "=") {
    setOption(state.options, longKey, arg.slice(3), state.repeatable);
    return 1;
  }
  return consumeFlagOrValue(longKey, i, argv, state);
}

/**
 * Handles the "bare --key" / "bare -k" cases where we decide between
 * a boolean flag and a `--key value` pair based on the flags set and
 * whether the next argv token looks like a value.
 */
function consumeFlagOrValue(
  key: string,
  i: number,
  argv: readonly string[],
  state: Mutable,
): number {
  if (state.flags.has(key)) {
    state.options[key] = true;
    return 1;
  }
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith("-")) {
    setOption(state.options, key, next, state.repeatable);
    return 2;
  }
  state.options[key] = true;
  return 1;
}

function setOption(
  options: Record<string, string | boolean | string[]>,
  key: string,
  value: string,
  repeatable: ReadonlySet<string>,
): void {
  if (repeatable.has(key)) {
    const existing = options[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (typeof existing === "string") {
      options[key] = [existing, value];
    } else {
      options[key] = [value];
    }
    return;
  }
  options[key] = value;
}
