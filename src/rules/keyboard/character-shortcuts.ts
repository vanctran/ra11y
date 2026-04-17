/**
 * Rule: keyboard/character-shortcuts
 * Satisfies: wcag22:2.1.4, wcag21:2.1.4
 * Spec: https://www.w3.org/TR/WCAG22/#character-key-shortcuts
 *
 * > If a keyboard shortcut is implemented in content using only letter
 * > (including upper- and lower-case letters), punctuation, number, or
 * > symbol characters, then at least one of the following is true:
 * > - Turn off: A mechanism is available to turn the shortcut off;
 * > - Remap: A mechanism is available to remap the shortcut to include
 * >   one or more non-printable keyboard characters (e.g. Ctrl, Alt);
 * > - Active only on focus: The keyboard shortcut for a user interface
 * >   component is only active when that component has focus.
 *
 * Source: https://www.w3.org/TR/WCAG22/#character-key-shortcuts
 *
 * Static-analysis scope: this SC is partially automatable. The
 * tractable signal is a JS/TSX `addEventListener('keydown' | 'keypress'
 * | 'keyup', handler)` attached to `window` or `document` whose handler
 * matches a single printable character (`event.key === 'a'`,
 * `e.keyCode === 83`, etc.) without also gating on a non-printable
 * modifier (`ctrlKey`, `metaKey`, `altKey`, `shiftKey`) and without
 * inspecting `event.target` (the focus-guard escape hatch).
 *
 * Severity is "warning" rather than "error" because the heuristic has
 * a false-positive surface: a handler that delegates to a focus check
 * via a helper, or that reads the focused element from a ref/store,
 * looks identical to the failing pattern in raw text. We trade some
 * noise for catching the F99 / F100 single-key shortcut antipattern.
 *
 * Implementation note: the v0.0.x TSX parser only exposes JSX
 * elements, not arbitrary JS expression bodies. We therefore inspect
 * `ctx.source` directly with a small set of regexes anchored on
 * `addEventListener(...)` calls. This is intentionally narrower than
 * a full JS AST walk and stays within the zero-dep invariant.
 */

import { defineRule } from "../../api/plugin.ts";

export const rule = defineRule({
  id: "keyboard/character-shortcuts",
  satisfies: ["wcag22:2.1.4", "wcag21:2.1.4"],
  severity: "warning",
  scope: "document",
  fixClass: "guidance",
  appliesTo: {
    fileExtensions: [".tsx", ".jsx", ".ts", ".js"],
  },
  docs: {
    description:
      "Global single-character keyboard shortcuts must be turn-off-able, remappable, or active-only-on-focus.",
    rationale:
      "Speech-input users (Dragon, Voice Control) and users with motor impairments who hold down keys can fire single-character shortcuts unintentionally, jumping pages or deleting content. Requiring a modifier (Ctrl/Alt/Cmd) or scoping the shortcut to a focused component prevents these accidental activations.",
    goodExample: `useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") save();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);`,
    badExample: `useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "s") save();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);`,
    normativeQuote:
      "If a keyboard shortcut is implemented in content using only letter, punctuation, number, or symbol characters, then at least one of the following is true: Turn off, Remap, or Active only on focus.",
    references: [
      "https://www.w3.org/TR/WCAG22/#character-key-shortcuts",
      "https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html",
      "https://www.w3.org/WAI/WCAG22/Techniques/failures/F99",
    ],
  },
  afterFile(ctx) {
    if (
      ctx.language !== "tsx" &&
      ctx.language !== "jsx" &&
      ctx.language !== "ts" &&
      ctx.language !== "js"
    ) {
      return;
    }
    for (const finding of findCharacterShortcutViolations(ctx.source)) {
      ctx.emit({
        severity: "warning",
        location: { filePath: ctx.filePath, line: finding.line, column: finding.column },
        message: finding.message,
        suggestion: finding.suggestion,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Matches `(window|document|globalThis).addEventListener('keydown', handler)`.
 * Captures the target object, the event name, and the second-argument
 * expression — which may be an identifier (named handler defined elsewhere
 * in the file) or an inline arrow / function expression.
 */
const ADD_EVENT_LISTENER_PATTERN =
  /\b(window|document|globalThis)\s*\.\s*addEventListener\s*\(\s*["'`](keydown|keypress|keyup)["'`]\s*,\s*/g;

/** Modifier property names whose presence in a handler body satisfies the SC. */
const MODIFIER_PROPERTIES: readonly string[] = ["ctrlKey", "metaKey", "altKey", "shiftKey"];

/** Tokens that suggest the handler verifies the focused element. */
const FOCUS_GUARD_TOKENS: readonly string[] = [
  ".target",
  "activeElement",
  "currentTarget",
  "isContentEditable",
];

/** Single printable-char comparison: `e.key === 'a'` (or `==`). */
const SINGLE_KEY_COMPARISON =
  /\b\w+\.key\s*===?\s*["'`]([A-Za-z0-9!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`~])["'`]/g;

/** Numeric key code comparison: `e.keyCode === 83`, `e.which === 83`. */
const KEYCODE_COMPARISON = /\b\w+\.(?:keyCode|which|charCode)\s*===?\s*(\d+)\b/g;

interface Finding {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly suggestion: string;
}

export function findCharacterShortcutViolations(source: string): readonly Finding[] {
  const out: Finding[] = [];
  ADD_EVENT_LISTENER_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null = ADD_EVENT_LISTENER_PATTERN.exec(source);
  while (m !== null) {
    const target = m[1] ?? "";
    const eventName = m[2] ?? "";
    const callStart = m.index;
    const handlerStart = ADD_EVENT_LISTENER_PATTERN.lastIndex;
    const handlerBody = extractHandlerBody(source, handlerStart);
    if (handlerBody !== null) {
      const finding = analyzeHandlerBody(handlerBody, source, callStart, target, eventName);
      if (finding !== null) out.push(finding);
    }
    m = ADD_EVENT_LISTENER_PATTERN.exec(source);
  }
  return out;
}

/**
 * From the position immediately after the comma following the event name,
 * extract the handler body text. Three shapes are supported:
 *
 *   addEventListener("keydown", (e) => { ... })
 *   addEventListener("keydown", function (e) { ... })
 *   addEventListener("keydown", namedHandler)        // resolves to the
 *                                                    // body of `const
 *                                                    // namedHandler = ...`
 *                                                    // earlier in source
 *
 * Returns the body text (between the outermost matched braces, or the
 * arrow-body expression for `=> expr` form), or null when the body cannot
 * be located.
 */
function extractHandlerBody(source: string, start: number): string | null {
  let i = start;
  while (i < source.length && /\s/.test(source[i] ?? "")) i++;
  if (i >= source.length) return null;
  const ch = source[i] ?? "";

  if (ch === "(" || ch === "f" || ch === "a") {
    return extractInlineHandlerBody(source, i);
  }
  const idMatch = /^([A-Za-z_$][\w$]*)/.exec(source.slice(i));
  if (idMatch) return findNamedHandlerBody(source, idMatch[1] ?? "");
  return null;
}

/** Inline arrow or function expression body extraction. */
function extractInlineHandlerBody(source: string, from: number): string | null {
  const brace = findBodyOpenBrace(source, from);
  if (brace !== -1) {
    const close = matchBrace(source, brace);
    if (close !== -1) return source.slice(brace + 1, close);
  }
  const arrow = source.indexOf("=>", from);
  const ARROW_LOOKAHEAD = 200;
  if (arrow !== -1 && arrow < from + ARROW_LOOKAHEAD) {
    const exprEnd = findArgEnd(source, arrow + 2);
    return source.slice(arrow + 2, exprEnd);
  }
  return null;
}

/**
 * Finds the `{` that opens an inline function body. Walks past the
 * parameter list `(...)` or `function name(...)`.
 */
function findBodyOpenBrace(source: string, from: number): number {
  // Find the parameter list opening paren.
  const paren = source.indexOf("(", from);
  if (paren === -1 || paren - from > 60) return -1;
  const closeParen = matchParen(source, paren);
  if (closeParen === -1) return -1;
  // Now look for `{` after the close paren (skipping `=>`, type annotations).
  let j = closeParen + 1;
  while (j < source.length && j < closeParen + 200) {
    const c = source[j] ?? "";
    if (c === "{") return j;
    if (c === ";" || c === ")") return -1;
    j++;
  }
  return -1;
}

function matchParen(source: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchBrace(source: string, openIdx: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < source.length; i++) {
    const c = source[i] ?? "";
    const next = stepStringState(c, inString);
    if (next.skipNext) i++;
    inString = next.inString;
    if (next.inString !== null || next.wasInString) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

interface StringStateStep {
  readonly inString: string | null;
  readonly wasInString: boolean;
  readonly skipNext: boolean;
}

function stepStringState(c: string, inString: string | null): StringStateStep {
  if (inString === null) {
    if (c === '"' || c === "'" || c === "`") {
      return { inString: c, wasInString: false, skipNext: false };
    }
    return { inString: null, wasInString: false, skipNext: false };
  }
  if (c === "\\") return { inString, wasInString: true, skipNext: true };
  if (c === inString) return { inString: null, wasInString: true, skipNext: false };
  return { inString, wasInString: true, skipNext: false };
}

/** Crudely finds the end of an argument expression at top-level depth. */
function findArgEnd(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i] ?? "";
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (c === "," && depth === 0) return i;
  }
  return source.length;
}

/**
 * Looks up a top-level handler defined as `const NAME = (...) => {...}`,
 * `let NAME = function (...) {...}`, or `function NAME(...) {...}` and
 * returns its body text. Returns null if not found or non-trivial.
 */
function findNamedHandlerBody(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns: readonly RegExp[] = [
    new RegExp(`(?:const|let|var)\\s+${escaped}\\s*(?::\\s*[^=]+)?=\\s*`, "g"),
    new RegExp(`function\\s+${escaped}\\s*\\(`, "g"),
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const m = pattern.exec(source);
    if (!m) continue;
    const tail = m.index + m[0].length;
    const brace = findBodyOpenBrace(source, tail - 1);
    if (brace !== -1) {
      const close = matchBrace(source, brace);
      if (close !== -1) return source.slice(brace + 1, close);
    }
  }
  return null;
}

/**
 * Decides whether a handler body fails SC 2.1.4. A body fails when it
 * compares an event property to a single printable key (or a printable
 * keyCode) WITHOUT also gating on a modifier and WITHOUT inspecting
 * `event.target` / `activeElement` / `currentTarget`.
 */
function analyzeHandlerBody(
  body: string,
  source: string,
  callStart: number,
  target: string,
  eventName: string,
): Finding | null {
  const flaggedKeys = collectPrintableKeys(body);
  if (flaggedKeys.length === 0) return null;
  if (hasModifierGuard(body)) return null;
  if (hasFocusGuard(body)) return null;

  const pos = positionAt(source, callStart);
  const keyList = flaggedKeys.slice(0, 3).join(", ");
  return {
    line: pos.line,
    column: pos.column,
    message: `Global ${eventName} listener on \`${target}\` matches printable key${flaggedKeys.length > 1 ? "s" : ""} (${keyList}) without a modifier or focus check.`,
    suggestion: `Either gate the shortcut on a non-printable modifier (e.g., \`(event.ctrlKey || event.metaKey) && event.key === "${flaggedKeys[0]}"\`), expose a setting to turn it off or remap it, or only attach the listener when the relevant component has focus (check \`event.target\` or scope the listener to that element).`,
  };
}

function collectPrintableKeys(body: string): readonly string[] {
  const keys: string[] = [];
  SINGLE_KEY_COMPARISON.lastIndex = 0;
  let m: RegExpExecArray | null = SINGLE_KEY_COMPARISON.exec(body);
  while (m !== null) {
    const k = m[1];
    if (k !== undefined) keys.push(k);
    m = SINGLE_KEY_COMPARISON.exec(body);
  }
  KEYCODE_COMPARISON.lastIndex = 0;
  let n: RegExpExecArray | null = KEYCODE_COMPARISON.exec(body);
  while (n !== null) {
    const code = Number(n[1] ?? "0");
    if (isPrintableKeyCode(code)) keys.push(`keyCode ${code}`);
    n = KEYCODE_COMPARISON.exec(body);
  }
  return keys;
}

/**
 * Printable key-code ranges (US keyboard layout, legacy keyCode):
 * - 48-57   digits 0-9
 * - 65-90   letters A-Z
 * - 186-222 punctuation/symbols (`;=,-./` etc.)
 */
const KEYCODE_DIGIT_MIN = 48;
const KEYCODE_DIGIT_MAX = 57;
const KEYCODE_LETTER_MIN = 65;
const KEYCODE_LETTER_MAX = 90;
const KEYCODE_PUNCT_MIN = 186;
const KEYCODE_PUNCT_MAX = 222;

function isPrintableKeyCode(code: number): boolean {
  return (
    (code >= KEYCODE_DIGIT_MIN && code <= KEYCODE_DIGIT_MAX) ||
    (code >= KEYCODE_LETTER_MIN && code <= KEYCODE_LETTER_MAX) ||
    (code >= KEYCODE_PUNCT_MIN && code <= KEYCODE_PUNCT_MAX)
  );
}

function hasModifierGuard(body: string): boolean {
  for (const prop of MODIFIER_PROPERTIES) {
    if (body.includes(prop)) return true;
  }
  return false;
}

function hasFocusGuard(body: string): boolean {
  for (const tok of FOCUS_GUARD_TOKENS) {
    if (body.includes(tok)) return true;
  }
  return false;
}

interface Position {
  readonly line: number;
  readonly column: number;
}

function positionAt(source: string, offset: number): Position {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
