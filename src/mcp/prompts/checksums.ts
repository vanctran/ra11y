/**
 * Per-prompt checksums for version-pinning.
 *
 * A host or a downstream tool may want to pin behavior against a
 * specific prompt version ("this workflow was tested against prompt
 * `ra11y/triage` with checksum `…`; warn me if the checksum drifts").
 * The checksum is a stable short SHA-256 over the prompt's
 * canonical serialization — name, description, argument list, and a
 * deterministic rendering using placeholder values for each
 * argument. A benign refactor that leaves the rendered output
 * unchanged also leaves the checksum unchanged; any edit that
 * changes what the host ultimately sees bumps the checksum.
 *
 * Zero deps — uses `node:crypto`.
 */

import { createHash } from "node:crypto";
import { BUILTIN_PROMPTS } from "./index.ts";
import type { Prompt } from "./types.ts";

/**
 * Length of the truncated hex digest we expose. 16 hex chars = 64
 * bits — enough space to make collisions across the prompt library
 * infeasible without bloating `prompts/list` responses or slash-
 * command menus that surface the checksum to users.
 */
export const PROMPT_CHECKSUM_LENGTH = 16;

/**
 * Stable placeholder for argument `name` in the canonical render.
 * Chosen over an empty string so the rendered text reads sensibly
 * and optional-branch logic inside prompts still exercises both
 * branches when it compares against truthy values.
 */
function canonicalArgValue(name: string): string {
  return `<${name}>`;
}

/**
 * Compute the checksum for a single prompt. Pure — same prompt in,
 * same hex out. Safe to call at module load time.
 */
export function computePromptChecksum(prompt: Prompt): string {
  const canonicalArgs: Record<string, string> = {};
  for (const arg of prompt.arguments) {
    canonicalArgs[arg.name] = canonicalArgValue(arg.name);
  }
  const rendered = prompt.render(canonicalArgs);
  const payload = JSON.stringify({
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments.map((a) => ({
      name: a.name,
      description: a.description,
      required: a.required,
    })),
    rendered: rendered.map((m) => ({
      role: m.role,
      type: m.content.type,
      text: m.content.text,
    })),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, PROMPT_CHECKSUM_LENGTH);
}

/**
 * Pre-computed checksum table for every built-in prompt. Populated
 * once at module load so `prompts/list` can return an `_meta.checksum`
 * without re-hashing on every request. The map is read-only — the
 * prompt library is static at build time.
 */
export const PROMPT_CHECKSUMS: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>();
  for (const prompt of BUILTIN_PROMPTS) {
    out.set(prompt.name, computePromptChecksum(prompt));
  }
  return out;
})();

/**
 * Look up a prompt's checksum by name. Returns `undefined` for
 * unknown names so callers can distinguish "registry miss" from
 * "empty string" — a pattern we apply consistently per CLAUDE.md §1
 * ("Ambiguous field shapes are dishonest").
 */
export function checksumForPrompt(name: string): string | undefined {
  return PROMPT_CHECKSUMS.get(name);
}
