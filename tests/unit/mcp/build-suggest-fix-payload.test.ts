/**
 * Tests for `buildSuggestFixPayload` — specifically Q2-VERIFYCMD, which
 * adds `verifyCommand` (prose) + `verifyCommandStructured` ({ tool:
 * "scan_file", args: { file, ruleId } }) to every response, regardless
 * of `kind`. Both fields are always populated — no conditional-spread —
 * because a suggest_fix response without a re-verify is never
 * meaningful.
 *
 * Other shape concerns around this function (mechanical edits, widened
 * anchors, caveats, snippet omission) are covered by
 * tests/unit/mcp/unique-anchor.test.ts and the integration suite in
 * tests/integration/mcp-tools.test.ts. This file focuses on the
 * verifyCommand fields.
 */

import { describe, expect, it } from "bun:test";

import {
  type BuildSuggestFixPayloadArgs,
  buildSuggestFixPayload,
  buildVerifyCommand,
} from "../../../src/mcp/tool-suggest-fix-internals.ts";
import type { Violation } from "../../../src/types/violation.ts";

const FILE_PATH = "src/components/Button.tsx";
const RULE_ID = "keyboard/handler-missing";

function violationWithFixPaths(overrides?: Partial<Violation>): Violation {
  return {
    ruleId: RULE_ID,
    fixClass: "mechanical",
    criteria: ["wcag22:2.1.1"],
    severity: "error",
    location: { filePath: FILE_PATH, line: 3, column: 1 },
    message: "Click handler without keyboard equivalent.",
    suggestion: "Add onKeyDown handler alongside onClick.",
    findingId: "abc123def456",
    groupKey: "def456abc123",
    fixPaths: {
      primary: {
        label: "Add onKeyDown sibling",
        edit: {
          oldText: "<div onClick={fn}>Click</div>",
          newText: "<div onClick={fn} onKeyDown={fn}>Click</div>",
        },
      },
      alternatives: [{ label: "Use a <button> element" }],
    },
    ...overrides,
  };
}

function violationGuidanceOnly(overrides?: Partial<Violation>): Violation {
  return {
    ruleId: RULE_ID,
    fixClass: "guidance",
    criteria: ["wcag22:2.1.1"],
    severity: "warning",
    location: { filePath: FILE_PATH, line: 3, column: 1 },
    message: "Interactive element lacks keyboard handler.",
    suggestion: "Review the surrounding context and add keyboard support.",
    findingId: "abc123def456",
    groupKey: "def456abc123",
    ...overrides,
  };
}

function baseArgs(
  match: Violation | undefined,
  overrides?: Partial<BuildSuggestFixPayloadArgs>,
): BuildSuggestFixPayloadArgs {
  return {
    ruleId: RULE_ID,
    line: 3,
    match,
    sourceContext: "line 1\nline 2\n<div onClick={fn}>Click</div>\nline 4\nline 5",
    source: "const x = 1;\nconst y = 2;\n<div onClick={fn}>Click</div>\nconst z = 3;\n",
    filePath: FILE_PATH,
    ...overrides,
  };
}

describe("buildVerifyCommand", () => {
  it("produces a scan_file-shaped structured hint with the given file + ruleId", () => {
    const result = buildVerifyCommand(FILE_PATH, RULE_ID);
    expect(result.verifyCommandStructured).toEqual({
      tool: "scan_file",
      args: { file: FILE_PATH, ruleId: RULE_ID },
    });
  });

  it("names scan_file (not scan_project) in the prose — narrowest verify surface", () => {
    const result = buildVerifyCommand(FILE_PATH, RULE_ID);
    expect(result.verifyCommand).toContain("scan_file");
    expect(result.verifyCommand).not.toContain("scan_project");
  });

  it("quotes the file path in the prose so agents copy it verbatim", () => {
    const result = buildVerifyCommand(FILE_PATH, RULE_ID);
    expect(result.verifyCommand).toContain(JSON.stringify(FILE_PATH));
  });

  it("includes the ruleId in the prose so the agent knows what to re-check", () => {
    const result = buildVerifyCommand(FILE_PATH, RULE_ID);
    expect(result.verifyCommand).toContain(RULE_ID);
  });
});

describe("buildSuggestFixPayload — verifyCommand on kind: 'edit'", () => {
  it("emits both verifyCommand + verifyCommandStructured when a mechanical edit is available", () => {
    const payload = buildSuggestFixPayload(baseArgs(violationWithFixPaths()));
    expect(payload["kind"]).toBe("edit");
    expect(typeof payload["verifyCommand"]).toBe("string");
    expect((payload["verifyCommand"] as string).length).toBeGreaterThan(0);
    expect(payload["verifyCommandStructured"]).toEqual({
      tool: "scan_file",
      args: { file: FILE_PATH, ruleId: RULE_ID },
    });
  });

  it("verifyCommandStructured.tool is exactly 'scan_file'", () => {
    const payload = buildSuggestFixPayload(baseArgs(violationWithFixPaths()));
    const structured = payload["verifyCommandStructured"] as { tool: string };
    expect(structured.tool).toBe("scan_file");
  });

  it("verifyCommandStructured.args.file matches the input filePath exactly", () => {
    const customPath = "packages/ui/src/widgets/Toolbar.tsx";
    const payload = buildSuggestFixPayload(
      baseArgs(violationWithFixPaths(), { filePath: customPath }),
    );
    const structured = payload["verifyCommandStructured"] as {
      args: { file: string };
    };
    expect(structured.args.file).toBe(customPath);
  });

  it("verifyCommandStructured.args.ruleId is included when the rule is known", () => {
    const payload = buildSuggestFixPayload(baseArgs(violationWithFixPaths()));
    const structured = payload["verifyCommandStructured"] as {
      args: { ruleId?: string };
    };
    expect(structured.args.ruleId).toBe(RULE_ID);
  });
});

describe("buildSuggestFixPayload — verifyCommand on kind: 'guidance'", () => {
  it("emits both fields when the response is guidance-only (no mechanical edit)", () => {
    const payload = buildSuggestFixPayload(baseArgs(violationGuidanceOnly()));
    expect(payload["kind"]).toBe("guidance");
    expect(typeof payload["verifyCommand"]).toBe("string");
    expect(payload["verifyCommandStructured"]).toEqual({
      tool: "scan_file",
      args: { file: FILE_PATH, ruleId: RULE_ID },
    });
  });

  it("emits both fields when fixPaths exist but no mechanical primary.edit is present", () => {
    // A fixPaths with labels-only primary should fall into the
    // `kind: "guidance"` branch of the `fixPaths` block — exercise
    // that the verify fields still attach there.
    const match = violationWithFixPaths({
      fixPaths: {
        primary: { label: "Review cross-file handler binding" },
        alternatives: [{ label: "Use a semantic element" }],
      },
    });
    const payload = buildSuggestFixPayload(baseArgs(match));
    expect(payload["kind"]).toBe("guidance");
    expect(typeof payload["verifyCommand"]).toBe("string");
    expect(payload["verifyCommandStructured"]).toEqual({
      tool: "scan_file",
      args: { file: FILE_PATH, ruleId: RULE_ID },
    });
  });
});

describe("buildSuggestFixPayload — verifyCommand on kind: 'none'", () => {
  it("emits both fields even when no violation matches at the requested line", () => {
    // `kind: "none"` is still a meaningful response — the agent may
    // want to re-verify the file after inspecting other lines or
    // after an unrelated edit. The verify hint is always honest.
    const payload = buildSuggestFixPayload(baseArgs(undefined));
    expect(payload["kind"]).toBe("none");
    expect(typeof payload["verifyCommand"]).toBe("string");
    expect(payload["verifyCommandStructured"]).toEqual({
      tool: "scan_file",
      args: { file: FILE_PATH, ruleId: RULE_ID },
    });
  });
});
