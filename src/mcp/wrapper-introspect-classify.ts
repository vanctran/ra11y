/**
 * Classification logic for `wrapper_introspect` — pure function over
 * a parsed file + component name. Decoupled from the MCP tool handler
 * so the same helper is callable from other surfaces (e.g. the
 * `wrapper/drift` rule's future "what did I see?" self-check) without
 * taking a session or a root.
 *
 * The ADR (0012) names six `observedRoot` buckets + three
 * `confidence` levels; this module collapses the full tag universe
 * onto that branching surface. The mapping is deliberately narrow —
 * the agent reading the file is the correct arbiter of edge cases
 * (e.g. `<span>` wrappers, shadow roots, custom-element stubs).
 */

import { firstJsxRootTag, type ProbeFile } from "../engine/wrapper-probe.ts";
import type { CachedIntrospectionRecord } from "./wrapper-introspect-cache.ts";

/** Native-interactive tags the probe accepts as "confirmed." */
const CONFIRMED_NATIVE_ROOTS: ReadonlySet<string> = new Set([
  "button",
  "a",
  "input",
  "textarea",
  "select",
]);

/**
 * Tags the probe recognises as "structurally a DOM element but not
 * native-interactive." Everything else (PascalCase component roots,
 * member expressions, etc.) lands on `opaque` so an agent can tell
 * "we saw a real div" from "we saw another wrapper."
 */
const KNOWN_NON_INTERACTIVE_ROOTS: ReadonlySet<string> = new Set([
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "p",
  "ul",
  "ol",
  "li",
  "figure",
  "figcaption",
]);

/**
 * Classifies a resolved file (matched by basename probe) against the
 * ADR's six-way `observedRoot` split. Pure over `(name, probeFile,
 * definitionFile)` — safe to memoize behind a content-hash cache.
 *
 * Confidence tiers:
 *   - `confirmed` — root is one of the native-interactive tags
 *     (`button` / `a` / `input` / `textarea` / `select`). Form-control
 *     tags collapse onto `observedRoot: "input"` so the agent's
 *     branching surface stays the four ADR-named DOM buckets.
 *   - `assumed` — file located but root is either a non-interactive
 *     DOM tag (→ `observedRoot: "div"`), another PascalCase component
 *     (→ `"opaque"`), or absent entirely (→ `"unknown"`).
 *
 * `unresolved` is NOT returned here — the caller synthesizes that
 * record when the basename probe fails, since no file means no probe
 * input.
 */
export function classifyResolvedWrapper(
  name: string,
  probeFile: ProbeFile,
  definitionFile: string,
): CachedIntrospectionRecord {
  const tag = firstJsxRootTag(probeFile);
  if (tag === null) {
    // File parses but has no JSX root (function returns null,
    // fragment-rooted render, bare module with no component body).
    // Distinct from `unresolved` — we HAVE the file, it just carries
    // no classifiable tag.
    return { name, definitionFile, observedRoot: "unknown", confidence: "assumed" };
  }
  if (tag === "button" || tag === "a") {
    return { name, definitionFile, observedRoot: tag, confidence: "confirmed" };
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return { name, definitionFile, observedRoot: "input", confidence: "confirmed" };
  }
  if (KNOWN_NON_INTERACTIVE_ROOTS.has(tag)) {
    return { name, definitionFile, observedRoot: "div", confidence: "assumed" };
  }
  // Defensive — a later addition to CONFIRMED_NATIVE_ROOTS should
  // land as `confirmed` on the matching tag rather than slipping
  // through to `opaque`.
  if (CONFIRMED_NATIVE_ROOTS.has(tag)) {
    return {
      name,
      definitionFile,
      observedRoot: tag as "button" | "a" | "input",
      confidence: "confirmed",
    };
  }
  return { name, definitionFile, observedRoot: "opaque", confidence: "assumed" };
}

/**
 * Synthesizes the record the tool emits when the basename probe finds
 * no matching file — ADR: `observedRoot: "unknown"`, `definitionFile:
 * null` (honest "no evidence"), `confidence: "unresolved"`.
 */
export function unresolvedRecord(name: string): CachedIntrospectionRecord {
  return { name, definitionFile: null, observedRoot: "unknown", confidence: "unresolved" };
}
