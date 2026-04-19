/**
 * Rule: wrapper/drift
 * Satisfies: wcag22:4.1.2, wcag21:4.1.2
 * Spec: https://www.w3.org/TR/WCAG22/#name-role-value
 *
 * > For all user interface components […] the name and role can be
 * > programmatically determined; states, properties, and values that
 * > can be set by the user can be programmatically set; and
 * > notification of changes to these items is available to user agents,
 * > including assistive technologies.
 *
 * Closes the asymmetry opened by `LoadedConfig.nativeWrapperElements`:
 * declaring `{ Button: "button", Link: "a" }` tells rules like
 * `keyboard/handler-missing` and `semantics/button-name` to treat every
 * `<Button …>` call site as-if it were a native `<button>`. That
 * declaration is load-bearing — fixing a wrapper so it really does
 * render the declared element is invisibly safe, but *breaking* a
 * wrapper so its JSX root drifts from the declared tag silently
 * neutralises every call-site check the declaration was there to keep
 * alive. WCAG 4.1.2 fails at every call site, and the scanner would
 * otherwise stay quiet because the declaration still silences them.
 *
 * This rule inverts that by emitting one violation *at the definition
 * file* whenever the first top-level JSX element there no longer
 * matches the declared tag. Agents (and humans) get a single honest
 * pointer: "you declared `<Button>` renders `<button>`; the definition
 * now renders `<div>`; update the config or restore the element." No
 * per-call-site noise; no silent regression.
 *
 * Scope caveats (deliberate, CLAUDE.md §1 "Don't duplicate capability
 * the agent already has"):
 *
 *   - Definition resolved via one-hop basename match on
 *     `ComponentName.{tsx,jsx,ts,js}` — the same probe the MCP
 *     `detect_native_wrappers` tool uses. No import resolution, no
 *     barrel-re-export following. When the definition isn't in the
 *     scan set we emit nothing: we have no evidence either way, and
 *     guessing produces false positives.
 *   - The probe inspects only the file's first top-level JSX element.
 *     Branching renders (`return cond ? <a /> : <button />`) may
 *     mislead the probe in either direction; that's the agent's job to
 *     arbitrate by reading the source when the rule points at it.
 *   - Glob-pattern wrapper names (`Icon*`, `*Button`) live in the
 *     `nativeWrappers` list but don't land on `nativeWrapperElements`
 *     by construction — there's no single definition file to point at.
 *     This rule processes only concrete `Name → tag` entries.
 */

import { defineRule } from "../../api/plugin.ts";
import type { ProbeFile } from "../../engine/wrapper-probe.ts";
import { firstJsxRootTag, indexFilesByComponentName } from "../../engine/wrapper-probe.ts";
import type { JsxElement, TsxModule } from "../../types/ast.ts";
import type { ProjectRuleFile } from "../../types/rule.ts";

export const rule = defineRule({
  id: "wrapper/drift",
  satisfies: ["wcag22:4.1.2", "wcag21:4.1.2"],
  severity: "error",
  scope: "project",
  fixClass: "guidance",
  docs: {
    description:
      "A component declared in `nativeWrappers` whose definition no longer renders the expected native element.",
    rationale:
      "Declaring `{ Button: 'button' }` tells other rules to treat every `<Button>` call site as-if it were `<button>`. If the definition drifts to `<div>`, every call-site check built on that declaration is silently suppressed — and the WCAG 4.1.2 failures at those call sites never reach the agent. Emitting once at the definition file makes the drift visible without re-noising each call site.",
    goodExample: `// ra11y.config.ts declares { Button: "button" }
// src/components/Button.tsx
export function Button(props) {
  return <button {...props} />;
}`,
    badExample: `// ra11y.config.ts declares { Button: "button" }
// src/components/Button.tsx — drifted from <button> to <div>
export function Button(props) {
  return <div role="button" {...props} />;
}`,
    normativeQuote:
      "For all user interface components, the name and role can be programmatically determined; states, properties, and values that can be set by the user can be programmatically set.",
    references: [
      "https://www.w3.org/TR/WCAG22/#name-role-value",
      "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html",
    ],
  },
  afterProject(ctx) {
    const entries = Object.entries(ctx.nativeWrapperElements);
    if (entries.length === 0) return;
    const index = indexFilesByComponentName(ctx.files.map(toProbeFile));
    for (const [name, expectedTag] of entries) {
      const file = index.get(name);
      // Definition outside scan scope: no evidence either way, skip.
      if (!file) continue;
      const actualTag = firstJsxRootTag(file);
      // No JSX in the defining file (bare TS helper matching by basename,
      // fragment-rooted render, etc.). Emit nothing — same "no evidence"
      // rationale as the missing-file case.
      if (actualTag === null) continue;
      const expectedLower = expectedTag.toLowerCase();
      if (actualTag === expectedLower) continue;
      const loc = firstJsxLocation(file) ?? { line: 1, column: 1 };
      ctx.emit({
        severity: "error",
        location: { filePath: file.filePath, line: loc.line, column: loc.column },
        message: buildMessage(name, expectedLower, actualTag),
        suggestion: buildSuggestion(name, expectedLower, actualTag, file.filePath),
      });
    }
  },
});

/** Adapts a `ProjectRuleFile` onto the probe's minimal shape. */
function toProbeFile(file: ProjectRuleFile): ProbeFile & { readonly original: ProjectRuleFile } {
  return {
    filePath: file.filePath,
    language: file.language,
    root: file.ast,
    original: file,
  };
}

/** First top-level JSX element's source location, if any. */
function firstJsxLocation(file: ProbeFile): { line: number; column: number } | null {
  const root = file.root as TsxModule | undefined;
  const first = root?.jsxElements?.[0] as JsxElement | undefined;
  if (!first) return null;
  return { line: first.loc.start.line, column: first.loc.start.column };
}

function buildMessage(name: string, expected: string, actual: string): string {
  return `<${name}> is declared in \`nativeWrappers\` to render <${expected}>, but its definition renders <${actual}> — call-site checks for <${expected}> are being silenced on a wrapper that no longer provides the declared element.`;
}

function buildSuggestion(name: string, expected: string, actual: string, filePath: string): string {
  return `Two honest fixes, pick one by reading ${filePath}: (1) restore the declared element — change the wrapper's root back to <${expected}> so every call site actually renders the declared semantics (preserves the silencing contract other rules depend on); or (2) update the mapping — change the \`nativeWrappers\` entry for '${name}' in \`ra11y.config.ts\` to '${actual}' (or remove it entirely if the component no longer wraps a native interactive element), so call-site rules stop treating <${name}> as a <${expected}>. Do NOT silence this with a pragma — the drift is real and call-site WCAG 4.1.2 checks are currently suppressed on stale evidence.`;
}
