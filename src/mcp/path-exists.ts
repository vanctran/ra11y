/**
 * Resolves `p` against `base` (when relative) and returns whether the
 * target exists on disk. Used by the scan tools before any parse work
 * to distinguish "scan target doesn't exist" (hard error envelope) from
 * "scan target exists but has zero parseable files" (soft
 * `warnings: ["scanned_zero_files"]` signal). Swallows every stat error
 * the same way — ENOENT, EACCES, and "is a symlink loop" all read as
 * "can't scan this" from the consumer's perspective, and the error
 * envelope's `details` names the path so the agent can investigate.
 *
 * Lives in its own file so `tools-helpers.ts` stays under the 500-line
 * file budget — `pathExists` is the only async fs probe that the
 * helpers module would need to carry, so it earns its own home.
 */

import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export async function pathExists(p: string, base?: string): Promise<boolean> {
  const abs = isAbsolute(p) ? p : resolve(base ?? process.cwd(), p);
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}
