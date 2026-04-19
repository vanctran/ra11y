/**
 * Built-in conformance profiles.
 *
 * A profile pins the scope an agent claims against when asked "make this
 * WCAG 2.1 AA conformant" — without it, every scan/coverage call
 * reconstructs the criterion filter from separate `--standard` +
 * `--level` flags. The profile is a named, pre-bundled `{standards,
 * level}` record so the agent picks one canonical scope and downstream
 * reports (coverage merge, conformance statement) filter against the
 * same tuple every call.
 *
 * Profiles are **pure data**, same discipline as `src/standards/`. Adding
 * a profile is a list-edit, never a code path. User-defined profiles
 * layer on top via `Config.profiles` — see `src/config/schema.ts` for
 * the duplicate-name + empty-standards checks that apply to both.
 *
 * The profile name is the user-facing handle (`--profile wcag22-aa`) and
 * the stable identifier downstream reports key against. Don't rename
 * shipped built-ins without a deprecation alias — v0.x semver is lax but
 * profile names are part of the agent contract.
 */

export interface ConformanceProfile {
  /** Lowercase kebab-case handle (`wcag22-aa`, `section508`, `en301549`). */
  readonly name: string;
  /** Standard IDs in scope. Must be non-empty. */
  readonly standards: readonly string[];
  /** Conformance level within those standards. Omitted when the standard has no level dimension. */
  readonly level?: "A" | "AA" | "AAA";
  /** One-line human summary surfaced by CLI error messages and docs. */
  readonly description: string;
}

export const BUILTIN_PROFILES: readonly ConformanceProfile[] = [
  {
    name: "wcag21-a",
    standards: ["wcag21"],
    level: "A",
    description:
      "WCAG 2.1 Level A — the minimum baseline for Web Content Accessibility Guidelines 2.1.",
  },
  {
    name: "wcag21-aa",
    standards: ["wcag21"],
    level: "AA",
    description: "WCAG 2.1 Level AA — the standard most regulatory frameworks cite.",
  },
  {
    name: "wcag22-a",
    standards: ["wcag22"],
    level: "A",
    description:
      "WCAG 2.2 Level A — the minimum baseline for Web Content Accessibility Guidelines 2.2.",
  },
  {
    name: "wcag22-aa",
    standards: ["wcag22"],
    level: "AA",
    description: "WCAG 2.2 Level AA — the default scope most modern projects target.",
  },
  {
    name: "wcag22-aaa",
    standards: ["wcag22"],
    level: "AAA",
    description:
      "WCAG 2.2 Level AAA — the strictest WCAG tier, used for specialized or high-stakes surfaces.",
  },
  {
    name: "section508",
    standards: ["section508"],
    description: "U.S. Section 508 (2018 refresh) — federal-agency ICT accessibility scope.",
  },
  {
    name: "en301549",
    standards: ["en301549"],
    description: "EN 301 549 — European ICT accessibility scope (public-sector procurement).",
  },
];

/**
 * Looks up a profile by name in the built-in set. Returns `undefined`
 * when the name is unknown — callers decide whether to fall back to a
 * user-defined profile list or error.
 */
export function getProfile(name: string): ConformanceProfile | undefined {
  for (const profile of BUILTIN_PROFILES) {
    if (profile.name === name) return profile;
  }
  return undefined;
}

/**
 * Resolves a profile name against the built-in list first, then any
 * user-supplied overlay (typically `LoadedConfig.profiles`). Built-ins
 * win on name collisions — the schema validator rejects overlay entries
 * that duplicate built-in names before they reach this function, so a
 * collision here indicates a caller bypassed validation.
 */
export function resolveProfile(
  name: string,
  userProfiles: readonly ConformanceProfile[] = [],
): ConformanceProfile | undefined {
  const builtin = getProfile(name);
  if (builtin !== undefined) return builtin;
  for (const profile of userProfiles) {
    if (profile.name === name) return profile;
  }
  return undefined;
}
