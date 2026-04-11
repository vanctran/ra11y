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

export function parseArgs(argv: readonly string[], opts: ParseOptions = {}): ParsedArgs {
  const flags = new Set(opts.flags ?? []);
  const aliases = opts.aliases ?? {};
  const repeatable = new Set(opts.repeatable ?? []);
  const options: Record<string, string | boolean | string[]> = {};
  const positionals: string[] = [];

  let i = 0;
  let afterSentinel = false;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      i += 1;
      continue;
    }
    if (afterSentinel) {
      positionals.push(arg);
      i += 1;
      continue;
    }
    if (arg === "--") {
      afterSentinel = true;
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        const value = arg.slice(eq + 1);
        setOption(options, key, value, repeatable);
      } else {
        const key = arg.slice(2);
        if (flags.has(key)) {
          options[key] = true;
        } else {
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith("-")) {
            setOption(options, key, next, repeatable);
            i += 1;
          } else {
            options[key] = true;
          }
        }
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const shortKey = arg[1] ?? "";
      const longKey = aliases[shortKey] ?? shortKey;
      if (arg.length > 2 && arg[2] !== "=") {
        // -f value style: -fsarif → format=sarif
        setOption(options, longKey, arg.slice(2), repeatable);
      } else if (arg.length > 2 && arg[2] === "=") {
        setOption(options, longKey, arg.slice(3), repeatable);
      } else if (flags.has(longKey)) {
        options[longKey] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          setOption(options, longKey, next, repeatable);
          i += 1;
        } else {
          options[longKey] = true;
        }
      }
      i += 1;
      continue;
    }

    positionals.push(arg);
    i += 1;
  }

  return { options, positionals };
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
