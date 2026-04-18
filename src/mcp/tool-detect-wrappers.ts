/**
 * The detect_native_wrappers MCP tool. Scans the project for unique
 * PascalCase components with onClick handlers and returns them as
 * candidates for the nativeWrappers config.
 *
 * This closes the onboarding loop: an agent can call this once, eyeball
 * the list, and add the real wrappers to config in one step.
 *
 * We do our own lightweight JSX walk here instead of piggybacking on
 * keyboard/handler-missing. The rule itself trusts PascalCase by
 * default (custom components are assumed keyboard-operable), but this
 * tool wants the inverse view: "which custom components with onClick
 * exist?" — same input, opposite intent.
 */

import { gitRoot } from "../utils/git.ts";
import { buildSuggestedConfigSnippet } from "./config-snippet.ts";
import { collectWrapperCandidates } from "./detect-wrappers-core.ts";
import { type McpTool, parseFiles, strParam, textResult } from "./tools-helpers.ts";

export const detectNativeWrappersTool: McpTool = {
  def: {
    name: "detect_native_wrappers",
    description:
      "Scan the project and list unique PascalCase components with onClick — onboarding aid for `nativeWrappers` in ra11y.config.ts. Each candidate carries a `definitionFile` pointer (absolute path resolved by one-hop basename match, or `null` when the source lives outside the scanned set) so you can open the wrapper directly to verify it wraps a native <button>/<a>/<input>. The tool does not modify files.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Project root. Defaults to the git root of the MCP server's spawn directory, then process.cwd().",
        },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    const spawnCwd = process.cwd();
    const root = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;

    const projectConfig = await session.loadProjectConfig(root);
    const files = await parseFiles([root], session, root);
    if (files.length === 0) {
      return textResult({
        scannedRoot: root,
        candidates: [],
        note: "No parseable files found.",
      });
    }

    const candidates = collectWrapperCandidates(files);
    const detectedNames = new Set(candidates.map((c) => c.component));
    const declared = [
      ...new Set([...projectConfig.nativeWrappers, ...session.config.nativeWrappers]),
    ];
    const absent = declared.filter((name) => !detectedNames.has(name));

    // Structured twin of the English nudge in `nextStep`: agents can
    // paste this directly into ra11y.config.ts instead of parsing the
    // prose. Conditional-spread per CLAUDE.md §1 "Ambiguous field
    // shapes are dishonest" — omit entirely when there are no
    // candidates to seed a snippet from, rather than ship `""`.
    const snippet = buildSuggestedConfigSnippet(
      candidates.map((c) => ({ component: c.component })),
    );
    const snippetField = snippet.length > 0 ? { suggestedConfigSnippet: snippet } : {};

    return textResult({
      scannedRoot: root,
      candidates,
      ...(absent.length > 0 ? { absentDeclaredWrappers: absent } : {}),
      ...snippetField,
      nextStep: buildNextStep(candidates, absent),
    });
  },
};

function buildNextStep(
  candidates: readonly { component: string }[],
  absent: readonly string[],
): string {
  const parts: string[] = [];
  if (candidates.length === 0) {
    parts.push("No PascalCase onClick components detected — nothing to register.");
  } else {
    const names = candidates.map((c) => `"${c.component}"`).join(", ");
    parts.push(
      `Found ${candidates.length} unique candidate${candidates.length === 1 ? "" : "s"}. Add the ones that truly wrap a native interactive element to \`nativeWrappers\` in ra11y.config.ts:\n\nexport default {\n  nativeWrappers: [${names}],\n};\n\nRemove any from the list that render a <div> or <span> internally — those are real bugs to fix.`,
    );
  }
  if (absent.length > 0) {
    parts.push(
      `\n\nDeclared but absent from JSX: [${absent.map((n) => `"${n}"`).join(", ")}]. These wrappers appear in your config but no component by that name was found in this scan — consider removing them from \`nativeWrappers\` unless you're about to add a usage.`,
    );
  }
  return parts.join("");
}
