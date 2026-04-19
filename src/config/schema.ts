/**
 * Config schema validators.
 *
 * Keeps shape-level validation that throws on malformed input out of
 * `loader.ts` so the loader stays focused on resolution + merge. The
 * loader's outer try/catch turns thrown errors here into a stderr
 * warning + defaults fallback, same policy as every other user-input
 * primitive (`processes`, `preset`, `nativeWrappers`).
 *
 * Validators return the normalized shape the loader writes onto
 * `LoadedConfig`. On bad input they throw an Error with an actionable
 * message — the message is surfaced verbatim to the user so include
 * the offending index or name.
 */

import type { ConformanceProfile } from "./profiles.ts";
import { BUILTIN_PROFILES } from "./profiles.ts";

/**
 * Validates a user-supplied `Config.profiles` array and returns the
 * normalized overlay written onto `LoadedConfig.profiles`.
 *
 * Rejects (throws):
 *   - non-array input
 *   - entries missing `name`, `standards`, or `description`
 *   - empty `standards` array (a profile that enforces zero standards
 *     is meaningless — downstream reports would fail their
 *     "every in-scope criterion has a positive source" check against
 *     the empty set)
 *   - duplicate names within the user overlay
 *   - a user name that collides with a {@link BUILTIN_PROFILES} name
 *     (built-ins are the stable contract; shadowing them would make
 *     `--profile wcag22-aa` produce different scans depending on which
 *     config the loader found)
 *   - `level` values outside `A | AA | AAA` when supplied
 */
export function validateProfiles(
  raw: readonly ConformanceProfile[] | undefined,
): readonly ConformanceProfile[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`profiles must be an array of { name, standards, description } entries`);
  }
  const builtinNames = new Set<string>(BUILTIN_PROFILES.map((p) => p.name));
  const seen = new Set<string>();
  const out: ConformanceProfile[] = [];
  for (let i = 0; i < raw.length; i++) {
    out.push(validateProfileEntry(raw[i], i, seen, builtinNames));
  }
  return out;
}

function validateProfileEntry(
  entry: unknown,
  i: number,
  seen: Set<string>,
  builtinNames: ReadonlySet<string>,
): ConformanceProfile {
  if (entry === undefined || entry === null || typeof entry !== "object") {
    throw new Error(`profiles[${i}] must be an object with name, standards, description`);
  }
  const name = (entry as { name?: unknown }).name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`profiles[${i}].name must be a non-empty string`);
  }
  if (builtinNames.has(name)) {
    throw new Error(
      `profiles[${i}].name \`${name}\` duplicates a built-in profile — rename the user-defined profile`,
    );
  }
  if (seen.has(name)) {
    throw new Error(`profiles[${i}].name duplicates an earlier entry: ${name}`);
  }
  seen.add(name);

  const standards = (entry as { standards?: unknown }).standards;
  if (!Array.isArray(standards)) {
    throw new Error(`profiles[${i}].standards must be an array of standard IDs`);
  }
  if (standards.length === 0) {
    throw new Error(
      `profiles[${i}].standards is empty — a profile with zero standards cannot gate conformance`,
    );
  }
  const normalizedStandards: string[] = [];
  for (let j = 0; j < standards.length; j++) {
    const id = standards[j];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`profiles[${i}].standards[${j}] must be a non-empty string`);
    }
    normalizedStandards.push(id);
  }

  const description = (entry as { description?: unknown }).description;
  if (typeof description !== "string" || description.length === 0) {
    throw new Error(`profiles[${i}].description must be a non-empty string`);
  }

  const rawLevel = (entry as { level?: unknown }).level;
  const level = normalizeProfileLevel(rawLevel, i);

  return {
    name,
    standards: normalizedStandards,
    ...(level === undefined ? {} : { level }),
    description,
  };
}

function normalizeProfileLevel(raw: unknown, i: number): ConformanceProfile["level"] | undefined {
  if (raw === undefined) return undefined;
  if (raw === "A" || raw === "AA" || raw === "AAA") return raw;
  throw new Error(`profiles[${i}].level must be one of "A" | "AA" | "AAA" when supplied`);
}
