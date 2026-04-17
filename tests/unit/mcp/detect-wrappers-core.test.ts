/**
 * Unit tests for `classifyWrapperCandidates` — the one-hop AST probe
 * that splits auto-detected wrapper candidates into `confirmed` (JSX
 * root is a native interactive element) vs `assumed` (can't confirm).
 *
 * Invariants under test:
 *   - wrapper rendering `<button>` → confirmed
 *   - wrapper rendering `<div role="button">` → assumed (not a native tag)
 *   - wrapper rendering a custom `<MyButton />` → assumed (one-hop only,
 *     we don't follow imports transitively)
 *   - wrapper whose defining file isn't in the parsed set → assumed
 *     (defensive default; the agent reading the source is the arbiter)
 *   - name-only heuristics are NOT applied: a `<Button>` candidate whose
 *     defining file renders `<div>` is assumed, not confirmed
 *   - `<a>`, `<input>`, `<textarea>`, `<select>` roots also confirm
 *   - sorting + empty-input behavior are deterministic
 *
 * See CLAUDE.md §1 "No heuristic suppression" — the probe is
 * deliberately narrow. Anything it can't structurally confirm defaults
 * to `assumed` so findings stay live.
 */

import { describe, expect, it } from "bun:test";
import type { ParsedFile } from "../../../src/engine/scanner.ts";
import { parseTsx } from "../../../src/input/parsers/index.ts";
import {
  classifyWrapperCandidates,
  collectWrapperCandidates,
} from "../../../src/mcp/detect-wrappers-core.ts";

function fileOf(filePath: string, source: string): ParsedFile {
  const r = parseTsx(source);
  return {
    filePath,
    source,
    ast: { language: "tsx", root: r.root, errors: r.errors },
  };
}

describe("classifyWrapperCandidates: confirmed cases", () => {
  it("classifies a wrapper rendering a plain <button> as confirmed", () => {
    const files: ParsedFile[] = [
      fileOf(
        "components/Button.tsx",
        "export function Button(props) { return <button {...props} />; }",
      ),
    ];
    const result = classifyWrapperCandidates(files, ["Button"]);
    expect(result.confirmed).toEqual(["Button"]);
    expect(result.assumed).toEqual([]);
  });

  it("classifies each of <a>, <input>, <textarea>, <select> roots as confirmed", () => {
    // All five native interactive tags the probe accepts — covers the
    // full CONFIRMED_NATIVE_ROOT_TAGS set in one shot.
    const files: ParsedFile[] = [
      fileOf("Link.tsx", "export const Link = (p) => <a {...p} />;"),
      fileOf("TextField.tsx", "export const TextField = (p) => <input {...p} />;"),
      fileOf("TextArea.tsx", "export const TextArea = (p) => <textarea {...p} />;"),
      fileOf("Dropdown.tsx", "export const Dropdown = (p) => <select {...p} />;"),
    ];
    const result = classifyWrapperCandidates(files, ["Link", "TextField", "TextArea", "Dropdown"]);
    expect(result.confirmed).toEqual(["Dropdown", "Link", "TextArea", "TextField"]);
    expect(result.assumed).toEqual([]);
  });

  it("ignores non-root JSX — only the FIRST top-level JSX element counts", () => {
    // Parser emits top-level JSX flat; a module that opens with <button>
    // confirms even if later top-level snippets reference other tags
    // (e.g. sibling helper components in the same file).
    const files: ParsedFile[] = [
      fileOf(
        "Button.tsx",
        [
          "export function Button(p) { return <button {...p} />; }",
          "export function Icon() { return <span className='icon' />; }",
        ].join("\n"),
      ),
    ];
    const result = classifyWrapperCandidates(files, ["Button"]);
    expect(result.confirmed).toEqual(["Button"]);
    expect(result.assumed).toEqual([]);
  });
});

describe("classifyWrapperCandidates: assumed cases (opaque, rules still fire)", () => {
  it("classifies a wrapper rendering <div role='button'> as assumed", () => {
    // role-attribute on a div is a real bug the agent needs to see —
    // the probe must NOT accept the role as a substitute for a native
    // tag.
    const files: ParsedFile[] = [
      fileOf(
        "PerceptionSlider.tsx",
        "export const PerceptionSlider = (p) => <div role='slider' {...p} />;",
      ),
    ];
    const result = classifyWrapperCandidates(files, ["PerceptionSlider"]);
    expect(result.confirmed).toEqual([]);
    expect(result.assumed).toEqual(["PerceptionSlider"]);
  });

  it("classifies a wrapper rendering a custom <MyButton /> as assumed (one-hop only)", () => {
    // One-hop discipline: if the wrapper renders another PascalCase
    // component, the probe stops there. Following MyButton into its
    // own file could turn a <div>-rendering bug into a false confirm.
    const files: ParsedFile[] = [
      fileOf("WidgetButton.tsx", "export const WidgetButton = (p) => <MyButton {...p} />;"),
      // Even though MyButton renders <button>, WidgetButton doesn't.
      fileOf("MyButton.tsx", "export const MyButton = (p) => <button {...p} />;"),
    ];
    const result = classifyWrapperCandidates(files, ["WidgetButton"]);
    expect(result.confirmed).toEqual([]);
    expect(result.assumed).toEqual(["WidgetButton"]);
  });

  it("classifies a wrapper whose defining file isn't in the parsed set as assumed", () => {
    // The file might live outside the scan root, be excluded by
    // .gitignore, or simply not yet have been parsed. Defaulting to
    // assumed preserves the "surface, don't suppress" invariant.
    const files: ParsedFile[] = [
      // Some unrelated file — no Button.tsx present.
      fileOf("app.tsx", "export const App = () => <Button onClick={x} />;"),
    ];
    const result = classifyWrapperCandidates(files, ["Button"]);
    expect(result.confirmed).toEqual([]);
    expect(result.assumed).toEqual(["Button"]);
  });

  it("does NOT use pattern-matching on component names — <Button> rendering <div> is assumed", () => {
    // Load-bearing against "a name ending in 'Button' must be a button"
    // heuristics. CLAUDE.md §1 "No heuristic suppression, even by name":
    // only actual JSX-root evidence counts.
    const files: ParsedFile[] = [
      fileOf("Button.tsx", "export const Button = (p) => <div {...p}>click me</div>;"),
    ];
    const result = classifyWrapperCandidates(files, ["Button"]);
    expect(result.confirmed).toEqual([]);
    expect(result.assumed).toEqual(["Button"]);
  });

  it("classifies a wrapper whose file has no JSX as assumed", () => {
    // A .ts file named after the component but exporting a non-JSX
    // helper isn't a confirmed wrapper — no root, no confirmation.
    const files: ParsedFile[] = [fileOf("Button.ts", "export const Button = (p) => ({ ...p });")];
    const result = classifyWrapperCandidates(files, ["Button"]);
    expect(result.confirmed).toEqual([]);
    expect(result.assumed).toEqual(["Button"]);
  });
});

describe("classifyWrapperCandidates: mixed + deterministic shape", () => {
  it("returns {confirmed: [], assumed: []} when given zero candidates", () => {
    const files: ParsedFile[] = [
      fileOf("Button.tsx", "export const Button = (p) => <button {...p} />;"),
    ];
    expect(classifyWrapperCandidates(files, [])).toEqual({
      confirmed: [],
      assumed: [],
    });
  });

  it("sorts both buckets alphabetically", () => {
    // Deterministic order matters for response-shape stability —
    // agents diff scans against baselines and a flapping order
    // produces spurious noise.
    const files: ParsedFile[] = [
      fileOf("Zebra.tsx", "export const Zebra = (p) => <button {...p} />;"),
      fileOf("Alpha.tsx", "export const Alpha = (p) => <button {...p} />;"),
      fileOf("Yak.tsx", "export const Yak = (p) => <div {...p} />;"),
      fileOf("Bear.tsx", "export const Bear = (p) => <div {...p} />;"),
    ];
    const result = classifyWrapperCandidates(files, ["Zebra", "Alpha", "Yak", "Bear"]);
    expect(result.confirmed).toEqual(["Alpha", "Zebra"]);
    expect(result.assumed).toEqual(["Bear", "Yak"]);
  });

  it("handles a realistic split — one confirmed, one assumed", () => {
    // The canonical P1-F scenario: a scan finds two auto-detect
    // candidates; the real <button> wrapper confirms, the
    // <div role='slider'> wrapper stays assumed and its findings
    // remain live.
    const files: ParsedFile[] = [
      fileOf("Button.tsx", "export const Button = (p) => <button {...p} />;"),
      fileOf(
        "BeliefSubmitButton.tsx",
        "export const BeliefSubmitButton = (p) => <div onClick={p.onClick}>submit</div>;",
      ),
    ];
    const result = classifyWrapperCandidates(files, ["Button", "BeliefSubmitButton"]);
    expect(result.confirmed).toEqual(["Button"]);
    expect(result.assumed).toEqual(["BeliefSubmitButton"]);
  });

  it("accepts both / and \\ path separators when resolving basename", () => {
    // Windows paths come through verbatim from the caller. The probe
    // must not care about separator flavor.
    const files: ParsedFile[] = [
      fileOf("src\\components\\Button.tsx", "export const Button = (p) => <button {...p} />;"),
    ];
    const result = classifyWrapperCandidates(files, ["Button"]);
    expect(result.confirmed).toEqual(["Button"]);
  });
});

describe("collectWrapperCandidates: definitionFile (Q2-WRAPPATH)", () => {
  // Q2-WRAPPATH: every candidate carries a `definitionFile` pointer so
  // agents can jump straight to the wrapper source without a Glob
  // round-trip. Resolution is one-hop basename match — the same probe
  // classifyWrapperCandidates uses. We surface the raw file path string
  // when a match exists, and `null` (never `""`, never omitted) when
  // the component is imported from outside the scan set (node_modules,
  // a sibling package, a barrel that renames the export).

  it("resolves definitionFile to the same file when the wrapper is declared inline", () => {
    // Usage site IS the definition site — the consumer file declares
    // the component locally. Basename match on `App.tsx` → `App` —
    // which doesn't match `Button`, so for the "wrapper used inline"
    // case we need the defining file's basename to equal the wrapper
    // name. Here, `Button.tsx` defines `Button` and also uses it in
    // a second render, so the same file is both definition and usage.
    const files: ParsedFile[] = [
      fileOf(
        "src/components/Button.tsx",
        [
          "export function Button(props) { return <button {...props} />; }",
          "export function Toolbar() { return <Button onClick={() => {}}>go</Button>; }",
        ].join("\n"),
      ),
    ];
    const result = collectWrapperCandidates(files);
    expect(result).toHaveLength(1);
    const [button] = result;
    expect(button?.component).toBe("Button");
    expect(button?.definitionFile).toBe("src/components/Button.tsx");
  });

  it("resolves definitionFile to the defining file when the wrapper is imported from a sibling file", () => {
    // Classic case: usage lives in `app.tsx`, definition lives in
    // `components/Button.tsx`. The probe indexes every parsed file by
    // PascalCase basename; `Button` resolves to `Button.tsx` even
    // though the scanner walked the usage site first.
    const files: ParsedFile[] = [
      fileOf(
        "src/app.tsx",
        [
          "import { Button } from './components/Button';",
          "export function App() { return <Button onClick={() => {}}>save</Button>; }",
        ].join("\n"),
      ),
      fileOf(
        "src/components/Button.tsx",
        "export function Button(props) { return <button {...props} />; }",
      ),
    ];
    const result = collectWrapperCandidates(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.definitionFile).toBe("src/components/Button.tsx");
  });

  it("stops at the barrel — one-hop resolution, no transitive following", () => {
    // Barrel re-exports (`index.ts` forwarding `Button` from
    // `./Button.tsx`) are a common pattern, but chasing them requires
    // an import resolver this scanner deliberately does not ship. The
    // probe matches basename `Button.tsx` against component name
    // `Button` directly — no hop through the barrel. This mirrors the
    // P1-F classifier's narrow-by-design discipline.
    const files: ParsedFile[] = [
      fileOf(
        "src/app.tsx",
        [
          "import { Button } from './components';",
          "export function App() { return <Button onClick={() => {}}>save</Button>; }",
        ].join("\n"),
      ),
      fileOf("src/components/index.ts", "export { Button } from './Button';"),
      fileOf(
        "src/components/Button.tsx",
        "export function Button(props) { return <button {...props} />; }",
      ),
    ];
    const result = collectWrapperCandidates(files);
    expect(result).toHaveLength(1);
    // Direct basename match wins — Button.tsx resolves without hopping
    // through the barrel. The `components/index.ts` re-export is
    // invisible to the probe by design.
    expect(result[0]?.definitionFile).toBe("src/components/Button.tsx");
  });

  it("emits definitionFile: null when the wrapper source is not in the parsed set", () => {
    // Usage site imports from `node_modules` (or any path outside the
    // scan): no `Button.tsx` in the parsed-file set, so the probe
    // returns null. The agent branches on null → fall back to Grep /
    // node_modules inspection. Critically, it is `null`, NOT `""` —
    // per CLAUDE.md §1 "Ambiguous field shapes are dishonest," the
    // empty string would look like a valid-but-empty path to downstream
    // consumers.
    const files: ParsedFile[] = [
      fileOf(
        "src/app.tsx",
        [
          "import { Button } from '@vendor/design-system';",
          "export function App() { return <Button onClick={() => {}}>save</Button>; }",
        ].join("\n"),
      ),
    ];
    const result = collectWrapperCandidates(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.definitionFile).toBeNull();
  });

  it("resolves each candidate independently in a mixed detection", () => {
    // Two candidates in the same scan: one in-tree, one out-of-tree.
    // The in-tree candidate resolves; the out-of-tree candidate is
    // `null`. Both surface in the primary list per the "surface, don't
    // suppress" doctrine.
    const files: ParsedFile[] = [
      fileOf(
        "src/app.tsx",
        [
          "import { Button } from './Button';",
          "import { VendorInput } from '@vendor/forms';",
          "export function App() {",
          "  return (<div>",
          "    <Button onClick={() => {}}>save</Button>",
          "    <VendorInput value={''} onChange={() => {}} />",
          "  </div>);",
          "}",
        ].join("\n"),
      ),
      fileOf("src/Button.tsx", "export const Button = (p) => <button {...p} />;"),
    ];
    const byName = new Map(collectWrapperCandidates(files).map((c) => [c.component, c]));
    expect(byName.get("Button")?.definitionFile).toBe("src/Button.tsx");
    expect(byName.get("VendorInput")?.definitionFile).toBeNull();
  });

  it('is a deterministic string-or-null — never `""`, never omitted', () => {
    // Shape-honesty guard. `definitionFile` is always present on every
    // candidate (never omitted) and is either a non-empty string or
    // exactly `null`. Empty string would be the canonical "ambiguous
    // field" bug.
    const files: ParsedFile[] = [
      fileOf("Alpha.tsx", "export const Alpha = (p) => <button {...p} />;"),
      fileOf("usage.tsx", "export const U = () => <MissingWrapper onClick={() => {}} />;"),
      fileOf("MoreUsage.tsx", "export const X = () => <Alpha onClick={() => {}} />;"),
    ];
    const result = collectWrapperCandidates(files);
    for (const c of result) {
      expect(c).toHaveProperty("definitionFile");
      const v = c.definitionFile;
      expect(v === null || (typeof v === "string" && v.length > 0)).toBe(true);
    }
  });
});
