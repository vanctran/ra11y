/**
 * The detect_native_wrappers MCP tool. Scans the project for unique
 * PascalCase components that would emit info-level keyboard/handler-missing
 * findings and returns them as candidates for the nativeWrappers config.
 *
 * This closes the onboarding loop: instead of running a scan, reading
 * info findings, copying component names into ra11y.config.ts, and
 * re-scanning, an agent can call this once, eyeball the list, and add
 * the real wrappers to config in one step.
 */

import { runScan } from "../engine/scanner.ts";
import { BUILTIN_RULES } from "../rules/index.ts";
import { BUILTIN_STANDARDS } from "../standards/index.ts";
import type { Violation } from "../types/violation.ts";
import { gitRoot } from "../utils/git.ts";
import {
  applyRuleSettings,
  findRule,
  type McpTool,
  parseFiles,
  resolveStandards,
  strParam,
  textResult,
} from "./tools-helpers.ts";

export const detectNativeWrappersTool: McpTool = {
  def: {
    name: "detect_native_wrappers",
    description:
      "Scan the project and list unique PascalCase components with onClick that would trigger info-level keyboard/handler-missing findings. Use this during initial onboarding to quickly populate `nativeWrappers` in ra11y.config.ts — scan the list, confirm which ones actually wrap a native <button>/<a>/<input>, and add those to config in one pass. The tool does not modify files.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description:
            "Project root. Defaults to the git root of the MCP server's spawn directory, then process.cwd().",
        },
        standard: { type: "string", description: "Standard ID. Defaults to session config." },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async handler(params, session) {
    const explicitCwd = strParam(params, "cwd");
    const spawnCwd = process.cwd();
    const root = explicitCwd ?? gitRoot(spawnCwd) ?? spawnCwd;

    // The check targets PascalCase components — confirm the rule is active.
    if (findRule("keyboard/handler-missing") === undefined) {
      return textResult({
        scannedRoot: root,
        candidates: [],
        note: "keyboard/handler-missing is not loaded; no candidates.",
      });
    }

    const standards = resolveStandards(strParam(params, "standard"), session);
    const files = await parseFiles([root], session, root);
    if (files.length === 0) {
      return textResult({
        scannedRoot: root,
        candidates: [],
        note: "No parseable files found.",
      });
    }

    const { result } = runScan({
      standards: BUILTIN_STANDARDS,
      rules: applyRuleSettings(BUILTIN_RULES, session.config.rules),
      enabled: standards,
      files,
    });

    const candidates = collectCandidates(result.violations);
    return textResult({
      scannedRoot: root,
      candidates,
      nextStep:
        candidates.length === 0
          ? "No PascalCase onClick components detected — nothing to register."
          : `Found ${candidates.length} unique candidate${candidates.length === 1 ? "" : "s"}. Add the ones that truly wrap a native interactive element to \`nativeWrappers\` in ra11y.config.ts:\n\nexport default {\n  nativeWrappers: [${candidates.map((c) => `"${c.component}"`).join(", ")}],\n};\n\nRemove any from the list that render a <div> or <span> internally — those are real bugs to fix.`,
    });
  },
};

interface Candidate {
  readonly component: string;
  readonly occurrences: number;
  readonly sampleLocations: readonly { readonly path: string; readonly line: number }[];
}

/**
 * Groups info-level keyboard/handler-missing findings by component name.
 * The rule's message starts with `<ComponentName>` so we can extract it
 * without a new field on Violation. Up to 3 sample locations per
 * component — enough for an agent to verify without the response blowing up.
 */
function collectCandidates(violations: readonly Violation[]): readonly Candidate[] {
  const groups = new Map<string, { count: number; locations: { path: string; line: number }[] }>();
  for (const v of violations) {
    if (v.ruleId !== "keyboard/handler-missing") continue;
    if (v.severity !== "info") continue;
    const match = /^<([A-Z][A-Za-z0-9]*)>/.exec(v.message);
    const name = match?.[1];
    if (!name) continue;
    const entry = groups.get(name) ?? { count: 0, locations: [] };
    entry.count += 1;
    if (entry.locations.length < SAMPLE_LIMIT) {
      entry.locations.push({ path: v.location.filePath, line: v.location.line });
    }
    groups.set(name, entry);
  }
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b))
    .map(([component, { count, locations }]) => ({
      component,
      occurrences: count,
      sampleLocations: locations,
    }));
}

const SAMPLE_LIMIT = 3;
