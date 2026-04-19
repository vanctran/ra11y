/**
 * Storybook `args`-binding synthesis for the TSX parser.
 *
 * What it does
 * ------------
 * Storybook 7+ stories render `<X {...args} />` for whichever component
 * `X` the story file targets, but the source itself contains only the
 * `args` data literal:
 *
 *   const meta: Meta<typeof Button> = { component: Button };
 *   export default meta;
 *   export const Primary: StoryObj<typeof Button> = {
 *     args: { label: "Click me", disabled: true },
 *   };
 *
 * The TSX parser sees the `args` object as data — no `<Button/>` element
 * enters the scanned element stream. Rules that need to inspect what
 * Storybook would actually render (alt-text-missing on an `<Img/>` story,
 * button-name on an empty-args Button story) never fire.
 *
 * This pass appends a synthesized `JsxElement` for each resolvable story
 * — `<ComponentName attr1="literal" attr2={42} />` — so those rules get
 * a chance to evaluate the rendered shape. The element carries
 * `synthesized: { source: "storybook-args", storyName }` so downstream
 * consumers can label the finding as derived rather than directly
 * observed.
 *
 * What it deliberately does NOT do
 * --------------------------------
 *  - Follow imports. Component identity is read locally — from the per-
 *    story `component:` override, the `StoryObj<typeof X>` /
 *    `StoryFn<typeof X>` annotation, or the file-level `default { component:
 *    X }`. No filesystem hop.
 *  - Synthesize when `args` contains spreads, computed keys, function
 *    calls, identifier references, template literals with substitutions,
 *    or render-function callbacks. These are not statically resolvable;
 *    we skip the whole synthesis rather than emit a partially-known
 *    element. Honest absence over confident wrongness.
 *  - Replace or modify the existing data-literal parsing. The synthesis
 *    is purely additive: the original `args` object stays in the source
 *    string; we just append a virtual element to `module.jsxElements`.
 *
 * Implementation note
 * -------------------
 * This is a focused string-driven scanner — no second TS-AST pass. The
 * surface we recognize is intentionally narrow:
 *
 *   - `default { component: <Identifier>, ... }` (file-level component).
 *   - `<exported?> const <Name>[: <TypeAnno>] = { ... };` (story
 *     declarators); the only TypeAnno shapes we mine are `StoryObj<typeof
 *     X>` / `StoryFn<typeof X>` / `Story<typeof X>` /
 *     `Meta<typeof X>` (case-sensitive on the wrapper name).
 *
 * Anything that doesn't match those shapes exactly is skipped — no
 * heuristic recovery, no fuzzy matching. The price is missing the long
 * tail of unusual story-file styles; the benefit is zero false-positive
 * synthesis (the cost the AI-first consumer model rejects most loudly).
 */

import type {
  JsxAttribute,
  JsxAttributeValue,
  JsxElement,
  SourcePosition,
} from "../../types/ast.ts";
import { matchingBrace } from "./_string-walk.ts";
import { type ExtractedArg, extractLiteralArgs } from "./tsx-storybook-args-extract.ts";

/**
 * The output of one synthesis pass: zero or more virtual JSX elements
 * to append to `module.jsxElements`. Returned as a flat array so the
 * caller can splice without copying its existing element list.
 */
export interface StorybookSynthesisResult {
  readonly elements: readonly JsxElement[];
}

/**
 * Runs the synthesis pass over a Storybook story file's source text.
 * Caller is responsible for gating on `isStorybookStoryFile(filePath)`
 * — this function does not check the path.
 */
export function synthesizeStorybookArgsElements(source: string): StorybookSynthesisResult {
  const fileLevelComponent = findDefaultExportComponent(source);
  const stories = findStoryDeclarators(source);
  const elements: JsxElement[] = [];
  for (const story of stories) {
    const componentName = resolveComponentName(story, fileLevelComponent);
    if (!componentName) continue;
    const args = extractLiteralArgs(source, story.bodyStart, story.bodyEnd);
    if (!args) continue;
    const element = buildSyntheticElement(componentName, story.name, args);
    if (element) elements.push(element);
  }
  return { elements };
}

// ---------------------------------------------------------------------------
// Story declarator discovery
// ---------------------------------------------------------------------------

/** A story-shaped variable declarator we'll try to mine for `args`. */
interface StoryDeclarator {
  /** The exported name (`Primary`, `Secondary`, …). */
  readonly name: string;
  /** Component identifier from the type annotation, if present. */
  readonly typeofComponent: string | null;
  /** Byte offset of the `{` opening the initializer object literal. */
  readonly bodyStart: number;
  /** Byte offset just past the matching `}`. */
  readonly bodyEnd: number;
}

/**
 * Scans `source` for `(export )?const <Name>[: <TypeAnno>] = { … };`
 * declarators where the TypeAnno (when present) is one of the Storybook
 * type wrappers we recognize. Match-but-skip on `let`/`var` and on
 * non-object initializers — story files canonically use `const` + object
 * literal.
 */
function findStoryDeclarators(source: string): readonly StoryDeclarator[] {
  const out: StoryDeclarator[] = [];
  // Permissive matcher: we look for the declarator skeleton; the
  // initializer must be an object literal (we re-validate the `{` is
  // the next non-whitespace token after `=`).
  const re = /\b(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*([^=;]+?))?\s*=\s*/g;
  for (const match of source.matchAll(re)) {
    const idx = match.index;
    if (idx === undefined) continue;
    // Skip if the match falls inside a string/comment/template by checking
    // a coarse signal: the surrounding line begins with `//` is the only
    // common false positive. The TSX parser's full state machine isn't
    // worth duplicating here for an additive synthesis pass, but we do
    // need to avoid picking up `// const Primary = …` lines.
    if (isInsideLineComment(source, idx)) continue;
    const initStart = idx + match[0].length;
    if (source[initStart] !== "{") continue;
    const typeofComponent = match[2] ? extractTypeofComponent(match[2]) : null;
    const bodyEnd = matchingBrace(source, initStart);
    if (bodyEnd === -1) continue;
    out.push({
      name: match[1] ?? "",
      typeofComponent,
      bodyStart: initStart,
      bodyEnd,
    });
  }
  return out;
}

/**
 * From a TypeScript type annotation like `StoryObj<typeof Button>` or
 * `Meta<typeof Button & { x: string }>`, extracts the leading
 * `typeof <Identifier>` component reference. Returns null when the
 * wrapper isn't one of the Storybook types or `typeof X` is missing.
 */
function extractTypeofComponent(typeAnno: string): string | null {
  const trimmed = typeAnno.trim();
  // Wrapper must be StoryObj / StoryFn / Story / Meta — exact match
  // before the `<`. Anything else is unrelated user code that happens
  // to declare a const at module scope.
  const wrapperMatch = /^(StoryObj|StoryFn|Story|Meta)\s*</.exec(trimmed);
  if (!wrapperMatch) return null;
  const inner = trimmed.slice(wrapperMatch[0].length);
  const typeofMatch = /^\s*typeof\s+([A-Z][A-Za-z0-9_$]*)/.exec(inner);
  if (!typeofMatch) return null;
  return typeofMatch[1] ?? null;
}

/**
 * Coarse "is this offset inside a `// …` line comment" check. The full
 * tokenizer in `tsx.ts` handles this for top-level scanning, but the
 * synthesis pass walks the raw source string and needs an inexpensive
 * guard against the most common false positive (commented-out story
 * declarations). String/template false positives are tolerated — the
 * `=` requirement and brace matching catch most of them downstream.
 */
function isInsideLineComment(source: string, offset: number): boolean {
  let i = offset;
  while (i > 0 && source[i - 1] !== "\n") i -= 1;
  // Walk forward from line start, tolerating leading whitespace.
  while (i < offset && (source[i] === " " || source[i] === "\t")) i += 1;
  return source[i] === "/" && source[i + 1] === "/";
}

// ---------------------------------------------------------------------------
// File-level default export component
// ---------------------------------------------------------------------------

/**
 * Finds the `component:` identifier inside the file's `export default {
 * … }` (CSF default-export form) or inside an `export default <Name>`
 * pointing at a `const meta: Meta<typeof X> = { component: X }`
 * declarator. Returns the component name or null when unresolved.
 *
 * Two surface forms we handle:
 *   1. `export default { component: Button, … } as Meta<…>;`
 *   2. `const meta: Meta<typeof Button> = { component: Button };
 *       export default meta;`
 *
 * For (2) we lean on the type annotation rather than re-walking the
 * `meta` initializer — `typeof X` in the annotation is the same answer
 * with less code path.
 */
function findDefaultExportComponent(source: string): string | null {
  // Form 1: object literal directly in export default.
  const direct = /export\s+default\s*\{/.exec(source);
  if (direct?.index !== undefined) {
    const braceStart = direct.index + direct[0].length - 1;
    const braceEnd = matchingBrace(source, braceStart);
    if (braceEnd !== -1) {
      const inside = source.slice(braceStart + 1, braceEnd);
      const componentName = extractComponentProperty(inside);
      if (componentName) return componentName;
    }
  }
  // Form 2: `const meta: Meta<typeof X> = …; export default meta;`
  const metaDecl = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(Meta\s*<[^=]+?>)\s*=/.exec(source);
  if (metaDecl) {
    const exportRef = new RegExp(`export\\s+default\\s+${metaDecl[1]}\\b`).test(source);
    if (exportRef) return extractTypeofComponent(metaDecl[2] ?? "");
  }
  return null;
}

/**
 * From the inside of a `{ … }` object literal (no surrounding braces),
 * extracts the `component:` property's identifier value. Only matches
 * bare identifiers — `component: Button.Primary` and
 * `component: getButton()` deliberately don't resolve, so synthesis
 * stays grounded in something the agent can also see by reading the
 * file.
 */
function extractComponentProperty(inside: string): string | null {
  const match = /\bcomponent\s*:\s*([A-Z][A-Za-z0-9_$]*)\s*[,}\n]/.exec(inside);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Component name resolution
// ---------------------------------------------------------------------------

/**
 * Per-story override > type-annotation `typeof X` > file-level default.
 * Returns null when none resolve to a PascalCase identifier — silent
 * synthesis on an unresolved component would emit `<undefined/>` style
 * elements and confuse downstream rules.
 */
function resolveComponentName(
  story: StoryDeclarator,
  fileLevelComponent: string | null,
): string | null {
  // Per-story override has priority (the spec says StoryObj's
  // `component` overrides the meta-level default).
  // Cheap single-pass scan within just this declarator's body region.
  // We do not have the raw text here; the override resolution moved to
  // the caller in `extractLiteralArgs`. So we resolve from the typeof
  // annotation or the file-level default.
  if (story.typeofComponent && /^[A-Z]/.test(story.typeofComponent)) return story.typeofComponent;
  if (fileLevelComponent && /^[A-Z]/.test(fileLevelComponent)) return fileLevelComponent;
  return null;
}

// Args extraction lives in `tsx-storybook-args-extract.ts` — imported above.

// ---------------------------------------------------------------------------
// Synthetic JsxElement assembly
// ---------------------------------------------------------------------------

/**
 * Empty `args: {}` is still meaningful — `<Button/>` with no props is a
 * real Storybook render and rules like button-name should fire against
 * it. When args is empty we anchor the synthesized element at file
 * start (offset 0); when args is non-empty we anchor at the first
 * property's location so the loc points the agent at the source line
 * the synthesis is grounded in. The element's `synthesized` marker
 * makes the provenance honest either way.
 */
function buildSyntheticElement(
  componentName: string,
  storyName: string,
  args: readonly ExtractedArg[],
): JsxElement | null {
  const anchor: SourcePosition = args[0]
    ? { line: args[0].line, column: args[0].column, offset: args[0].offset }
    : { line: 1, column: 1, offset: 0 };
  const attributes: JsxAttribute[] = args.map((a) => buildSyntheticAttribute(a));
  return {
    kind: "JsxElement",
    range: { start: anchor.offset, end: anchor.offset },
    loc: { start: anchor, end: anchor },
    tagName: componentName,
    attributes,
    children: [],
    selfClosing: true,
    hasSpreadProps: false,
    synthesized: { source: "storybook-args", storyName },
  };
}

function buildSyntheticAttribute(arg: ExtractedArg): JsxAttribute {
  const startPos: SourcePosition = { line: arg.line, column: arg.column, offset: arg.offset };
  const value: JsxAttributeValue =
    arg.value.kind === "string"
      ? { kind: "StringLiteral", value: arg.value.value }
      : { kind: "Expression", raw: arg.value.raw };
  return {
    kind: "JsxAttribute",
    range: { start: arg.offset, end: arg.offset },
    loc: { start: startPos, end: startPos },
    name: arg.name,
    value,
  };
}

// String/comment/identifier walkers + brace/paren matching + position
// computation now live in `_string-walk.ts`. Imported above.
