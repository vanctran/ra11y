/**
 * ANSI color primitives. Zero-dep, deterministic, respects NO_COLOR and
 * non-TTY. Every style helper is a pure function `(text) => string`, so
 * composition is just nesting function calls:
 *
 *   bold(red("error"))
 *
 * When color is disabled (NO_COLOR, FORCE_COLOR=0, non-TTY), every helper
 * becomes an identity function. Callers don't need to branch — just write
 * styled text and trust the utils layer to do the right thing at runtime.
 */

export interface ColorSupport {
  /** Emit any ANSI codes at all? */
  readonly enabled: boolean;
}

function shouldEnable(): boolean {
  const env = process.env;
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR === "0") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "") return true;
  const stdout = process.stdout as { isTTY?: boolean };
  return stdout.isTTY === true;
}

let state: ColorSupport = { enabled: shouldEnable() };

/** Force color support on or off. Useful for testing and CLI flags. */
export function setColorEnabled(enabled: boolean): void {
  state = { enabled };
}

/** Current color state. */
export function colorEnabled(): boolean {
  return state.enabled;
}

function wrap(open: number, close: number) {
  return (text: string): string => {
    if (!state.enabled) return text;
    return `\u001b[${open}m${text}\u001b[${close}m`;
  };
}

// Foreground colors
export const black = wrap(30, 39);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const white = wrap(37, 39);
export const gray = wrap(90, 39);
export const brightRed = wrap(91, 39);
export const brightYellow = wrap(93, 39);
export const brightCyan = wrap(96, 39);

// Styles
export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const italic = wrap(3, 23);
export const underline = wrap(4, 24);
export const inverse = wrap(7, 27);
export const strike = wrap(9, 29);

/** Removes ANSI escape sequences from a string — useful for length calculations. */
export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences are control chars by definition
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}
