/**
 * Structured logger.
 *
 * Biome bans `console.*` in src/. All internal logging goes through this
 * module. Default level is `warn`; `--debug` or `RA11Y_DEBUG=1` promotes
 * to `debug`. Output always goes to stderr — stdout is reserved for
 * formatted scan results.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type LevelName = keyof typeof LEVELS;

let currentLevel: LevelName =
  process.env.RA11Y_DEBUG === "1" || process.env.RA11Y_DEBUG === "true" ? "debug" : "warn";

export function setLogLevel(level: LevelName): void {
  currentLevel = level;
}

function emit(level: LevelName, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const prefix = `[ra11y ${level}]`;
  if (fields && Object.keys(fields).length > 0) {
    process.stderr.write(`${prefix} ${msg} ${JSON.stringify(fields)}\n`);
  } else {
    process.stderr.write(`${prefix} ${msg}\n`);
  }
}

export const logger = {
  debug(msg: string, fields?: Record<string, unknown>): void {
    emit("debug", msg, fields);
  },
  info(msg: string, fields?: Record<string, unknown>): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emit("error", msg, fields);
  },
};
