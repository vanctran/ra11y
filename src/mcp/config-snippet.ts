/**
 * Builds a `ra11y.config.ts` fragment from a list of confirmed wrapper
 * names. Emitted as a structured `suggestedConfigSnippet` field on the
 * `detect_native_wrappers` response (Q2R2-CFG-SNIPPET) so agents can
 * paste it directly instead of parsing the English `nextStep` prose.
 *
 * Two output shapes, chosen by whether any wrapper carries a mapped
 * native element (the object-form `Config.nativeWrappers` from
 * Q2-WRAPMAP):
 *
 *   - **array form** — when every input is name-only. Emits
 *     `defineConfig({ nativeWrappers: ["Button", "Link"] })`. Opaque
 *     names; rules only know "skip this, it's a wrapper."
 *
 *   - **object form** — when at least one input carries a non-null
 *     `element`. Emits `defineConfig({ nativeWrappers: { Button:
 *     "button", Link: "a" } })`. Names mapped to the native element
 *     they render; rules that depend on the underlying semantics
 *     (link-descriptive-text, alt-text) can flow through the wrapper.
 *
 * Names / keys are sorted lexicographically so the output is stable
 * across runs. Two-space indentation matches project Biome style; each
 * list/object has a trailing comma on its final entry.
 *
 * The caller decides whether to emit the snippet at all — per CLAUDE.md
 * §1 "Ambiguous field shapes are dishonest," the response omits the
 * field entirely when there's nothing to suggest (zero confirmed
 * wrappers), rather than shipping an empty string.
 */

/**
 * One row of input to the snippet builder. `element` carries the native
 * tag the wrapper resolves to when the consumer can identify it (e.g.
 * `"button"`, `"a"`, `"input"`). Leave undefined (or null) when the
 * wrapper is name-only — the builder collapses all-name-only input to
 * the array form.
 */
export interface ConfirmedWrapperForSnippet {
  readonly component: string;
  readonly element?: string | null;
}

/** Indent width for the emitted snippet body. Matches project Biome style. */
const INDENT = "  ";

/**
 * Builds the `defineConfig({ nativeWrappers: ... })` snippet. Returns
 * an empty string when the input list is empty — the caller is
 * expected to omit the field entirely in that case (conditional-spread
 * at the assembly site, never `""` in the response).
 */
export function buildSuggestedConfigSnippet(
  wrappers: readonly ConfirmedWrapperForSnippet[],
): string {
  if (wrappers.length === 0) return "";
  const anyMapped = wrappers.some((w) => typeof w.element === "string" && w.element.length > 0);
  if (anyMapped) return buildObjectForm(wrappers);
  return buildArrayForm(wrappers);
}

function buildArrayForm(wrappers: readonly ConfirmedWrapperForSnippet[]): string {
  const names = [...new Set(wrappers.map((w) => w.component))].sort();
  const lines = names.map((name) => `${INDENT}${INDENT}${JSON.stringify(name)},`);
  return ["defineConfig({", `${INDENT}nativeWrappers: [`, ...lines, `${INDENT}],`, "});"].join(
    "\n",
  );
}

function buildObjectForm(wrappers: readonly ConfirmedWrapperForSnippet[]): string {
  // Object form needs a name→element entry per wrapper. Names without a
  // mapping still appear (the consumer verified them, just without an
  // element), with `null` as the element — preserves the "we saw this
  // but couldn't map it" signal rather than silently dropping the row.
  const byName = new Map<string, string | null>();
  for (const { component, element } of wrappers) {
    const mapped = typeof element === "string" && element.length > 0 ? element : null;
    // First mapping wins when a component appears twice with different
    // elements; the caller is responsible for deduping upstream if it
    // cares. In practice the detect tool produces one row per name.
    if (!byName.has(component)) byName.set(component, mapped);
  }
  const sorted = [...byName.keys()].sort();
  const entries = sorted.map((name) => {
    const element = byName.get(name);
    const value = element === null ? "null" : JSON.stringify(element);
    return `${INDENT}${INDENT}${JSON.stringify(name)}: ${value},`;
  });
  return ["defineConfig({", `${INDENT}nativeWrappers: {`, ...entries, `${INDENT}},`, "});"].join(
    "\n",
  );
}
