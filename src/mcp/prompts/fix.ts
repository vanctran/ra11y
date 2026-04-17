/**
 * Prompt: ra11y/fix — guides an agent through a single-finding fix loop
 * using suggest_fix + apply_fix with a mandatory dryRun gate before any
 * disk write.
 */
import type { Prompt } from "./types.ts";

export const fixPrompt: Prompt = {
  name: "ra11y/fix",
  description:
    "Fix one ra11y finding end-to-end: suggest the edit, dry-run apply, review the delta, then apply for real.",
  arguments: [
    {
      name: "findingId",
      description:
        "Optional identifier of a specific finding to fix (e.g. `contrast/minimum@src/Button.tsx:42`). Omit and the agent will pick the highest-confidence unfixed finding from a fresh scan.",
      required: false,
    },
  ],
  render(args) {
    const findingId = args["findingId"];
    const selectLine = findingId
      ? `Target the finding identified as \`${findingId}\`. Parse \`ruleId@file:line\` out of it.`
      : 'Call `scan_project` first. Pick the first `error`-severity finding with a `fix` suggestion. If none exist, fall through to the highest-confidence `warning`. If nothing is fixable, return `{ status: "no-fix-available", scanned: <count> }` and stop.';
    const text = [
      "You are applying a single ra11y fix. Work in order; do not skip the dry-run.",
      "",
      `1. ${selectLine}`,
      "2. Call `suggest_fix` with `{ ruleId, file, line }`. Inspect the response:",
      '   - `kind: "edit"` → `primary.edit` has `oldText`/`newText`; proceed to step 3.',
      '   - `kind: "guidance"` → no mechanical edit; compose one from `sourceContext` + `explanation`, then feed that into `apply_fix` as a manual edit, or stop and return `{ status: "manual-only", guidance }`.',
      '   - `kind: "none"` → the finding has moved; rescan and pick a new target.',
      "3. `apply_fix` writes to disk. Before any write call runs, the session must have `configure({ allowWrite: true })` in effect. Call `configure` with `allowWrite: true` now if you haven't already.",
      "4. Call `apply_fix` with `dryRun: true` first. Read back the `preview` and the reported `oldText`/`newText` spans. Do not proceed if the preview touches code outside the reported line range, or if `newText` is empty.",
      "5. Call `apply_fix` with `dryRun: false`. Confirm the response reports `applied: true` and echoes the same `newText` you approved in step 4.",
      '6. Call `scan_file` on the edited path. Confirm the original `ruleId` no longer fires on that `line`. If it still fires, revert the edit and return `{ status: "rejected", reason }`.',
      "",
      "Return this shape as your final message:",
      "- `status`: one of `applied`, `rejected`, `manual-only`, `no-fix-available`.",
      "- `finding`: `{ ruleId, file, line }` of the target.",
      "- `edit`: `{ oldText, newText }` when `applied`; omit otherwise.",
      "- `rescan`: `{ stillFiring: boolean }` when `applied`.",
      "Stop. Do not chain into a second fix unless the user asked for batch mode.",
    ].join("\n");
    return [{ role: "user", content: { type: "text", text } }];
  },
};
