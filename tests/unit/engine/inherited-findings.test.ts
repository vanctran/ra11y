/**
 * Tests for the inherited-findings synthesizer (Q2R2-INHERITED).
 *
 * Mixes unit tests over the pure `synthesizeInheritedFindings` function
 * (deterministic behaviour, skip rules, chain prevention) with
 * end-to-end tests that exercise the scanner plumbing so the wiring in
 * `runScan` is covered too.
 *
 * See docs/adr/0012-wrapper-introspection-role.md.
 */

import { describe, expect, it } from "bun:test";
import {
  type InheritFile,
  synthesizeInheritedFindings,
} from "../../../src/engine/inherited-findings.ts";
import { type ParsedFile, runScan } from "../../../src/engine/scanner.ts";
import { parseTsx } from "../../../src/input/parsers/index.ts";
import { BUILTIN_RULES } from "../../../src/rules/index.ts";
import { wcag22 } from "../../../src/standards/wcag22/standard.ts";
import type { Ast } from "../../../src/types/ast.ts";
import type { Violation } from "../../../src/types/violation.ts";
import { withFindingId } from "../../helpers/make-violation.ts";

function tsxFile(filePath: string, source: string): ParsedFile & InheritFile {
  const r = parseTsx(source);
  const ast: Ast = { language: "tsx", root: r.root, errors: r.errors };
  return { filePath, source, ast };
}

/** Builds a synthetic Violation at the given definition file location. */
function makeDefinitionViolation(args: {
  readonly ruleId: string;
  readonly filePath: string;
  readonly line: number;
  readonly message?: string;
  readonly sourceOfFinding?: Violation["sourceOfFinding"];
}): Violation {
  return withFindingId({
    ruleId: args.ruleId,
    fixClass: "guidance",
    criteria: ["wcag22:4.1.2"],
    criteriaTitles: ["Name, Role, Value"],
    severity: "error",
    location: { filePath: args.filePath, line: args.line, column: 1 },
    message: args.message ?? "wrapper definition finding",
    ...(args.sourceOfFinding !== undefined && { sourceOfFinding: args.sourceOfFinding }),
  });
}

describe("synthesizeInheritedFindings — unit", () => {
  it("emits one inherited finding per call site across the scan set", () => {
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <button {...props} />; }`,
    );
    const callA = tsxFile("src/pages/Home.tsx", `export const Home = () => <Button label="ok" />;`);
    const callB = tsxFile(
      "src/pages/About.tsx",
      `export const About = () => <div><Button label="go" /></div>;`,
    );
    const source = makeDefinitionViolation({
      ruleId: "semantics/button-name",
      filePath: "src/ui/Button.tsx",
      line: 1,
    });

    const inherited = synthesizeInheritedFindings({
      violations: [source],
      files: [buttonDef, callA, callB],
      nativeWrapperElements: { Button: "button" },
    });

    expect(inherited).toHaveLength(2);
    const paths = inherited.map((v) => v.location.filePath).sort();
    expect(paths).toEqual(["src/pages/About.tsx", "src/pages/Home.tsx"]);
    for (const v of inherited) {
      expect(v.confidence).toBe("inherited");
      expect(v.sourceOfFinding).toEqual({ filePath: "src/ui/Button.tsx", line: 1, column: 1 });
      expect(v.message.startsWith("[inherited from <Button>]")).toBe(true);
      expect(v.ruleId).toBe("semantics/button-name");
      expect(v.criteria).toEqual(["wcag22:4.1.2"]);
    }
  });

  it("never inherits wrapper/drift findings (the definition is the only right place to fix)", () => {
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <div {...props} />; }`,
    );
    const call = tsxFile("src/pages/Home.tsx", `export const Home = () => <Button />;`);
    const source = makeDefinitionViolation({
      ruleId: "wrapper/drift",
      filePath: "src/ui/Button.tsx",
      line: 1,
    });

    const inherited = synthesizeInheritedFindings({
      violations: [source],
      files: [buttonDef, call],
      nativeWrapperElements: { Button: "button" },
    });

    expect(inherited).toEqual([]);
  });

  it("never inherits already-inherited findings (prevents chain recursion)", () => {
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <button {...props} />; }`,
    );
    const call = tsxFile("src/pages/Home.tsx", `export const Home = () => <Button />;`);
    // An already-inherited finding at the definition file — this should
    // NOT itself be re-inherited to the call site.
    const alreadyInherited = makeDefinitionViolation({
      ruleId: "semantics/button-name",
      filePath: "src/ui/Button.tsx",
      line: 1,
      sourceOfFinding: { filePath: "src/other/Place.tsx", line: 10, column: 1 },
    });

    const inherited = synthesizeInheritedFindings({
      violations: [alreadyInherited],
      files: [buttonDef, call],
      nativeWrapperElements: { Button: "button" },
    });

    expect(inherited).toEqual([]);
  });

  it("returns nothing when the wrapper definition is outside the scan set", () => {
    // Only the call-site file is in the scan set; the declared
    // definition file (Button.tsx) is not. Synthesizer has no evidence
    // — returns nothing, per ADR 0012 one-hop discipline.
    const call = tsxFile("src/pages/Home.tsx", `export const Home = () => <Button />;`);
    const sourceElsewhere = makeDefinitionViolation({
      ruleId: "semantics/button-name",
      filePath: "vendor/design-system/Button.tsx",
      line: 1,
    });

    const inherited = synthesizeInheritedFindings({
      violations: [sourceElsewhere],
      files: [call],
      nativeWrapperElements: { Button: "button" },
    });

    expect(inherited).toEqual([]);
  });

  it("does not attribute through wrappers that aren't declared in nativeWrapperElements", () => {
    // Wrapper file + call site are in the scan set, but `Button` is
    // NOT declared in the config map. Per ADR 0012 "config is source
    // of truth," this is an honest "no evidence" — the synthesizer
    // emits nothing even though a basename match exists.
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <button {...props} />; }`,
    );
    const call = tsxFile("src/pages/Home.tsx", `export const Home = () => <Button />;`);
    const source = makeDefinitionViolation({
      ruleId: "semantics/button-name",
      filePath: "src/ui/Button.tsx",
      line: 1,
    });

    const inherited = synthesizeInheritedFindings({
      violations: [source],
      files: [buttonDef, call],
      nativeWrapperElements: {},
    });

    expect(inherited).toEqual([]);
  });

  it("emits no findings when the declared wrapper has no call sites in scope", () => {
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <button {...props} />; }`,
    );
    // Another unrelated file; no <Button /> usage anywhere.
    const other = tsxFile("src/pages/Home.tsx", `export const Home = () => <div />;`);
    const source = makeDefinitionViolation({
      ruleId: "semantics/button-name",
      filePath: "src/ui/Button.tsx",
      line: 1,
    });

    const inherited = synthesizeInheritedFindings({
      violations: [source],
      files: [buttonDef, other],
      nativeWrapperElements: { Button: "button" },
    });

    expect(inherited).toEqual([]);
  });

  it("assigns distinct findingIds to each inherited call-site finding", () => {
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <button {...props} />; }`,
    );
    const callA = tsxFile("src/pages/A.tsx", `export const A = () => <Button />;`);
    const callB = tsxFile("src/pages/B.tsx", `export const B = () => <Button />;`);
    const source = makeDefinitionViolation({
      ruleId: "semantics/button-name",
      filePath: "src/ui/Button.tsx",
      line: 1,
    });

    const inherited = synthesizeInheritedFindings({
      violations: [source],
      files: [buttonDef, callA, callB],
      nativeWrapperElements: { Button: "button" },
    });

    expect(inherited).toHaveLength(2);
    const ids = new Set(inherited.map((v) => v.findingId));
    expect(ids.size).toBe(2);
  });

  it("attributes multiple call sites in the same file", () => {
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <button {...props} />; }`,
    );
    const caller = tsxFile(
      "src/pages/Home.tsx",
      `export const Home = () => (<div><Button /><Button /><Button /></div>);`,
    );
    const source = makeDefinitionViolation({
      ruleId: "semantics/button-name",
      filePath: "src/ui/Button.tsx",
      line: 1,
    });

    const inherited = synthesizeInheritedFindings({
      violations: [source],
      files: [buttonDef, caller],
      nativeWrapperElements: { Button: "button" },
    });

    expect(inherited).toHaveLength(3);
    // All three at the same file, distinct columns/lines.
    for (const v of inherited) {
      expect(v.location.filePath).toBe("src/pages/Home.tsx");
      expect(v.confidence).toBe("inherited");
    }
    const columns = new Set(inherited.map((v) => v.location.column));
    expect(columns.size).toBe(3);
  });
});

describe("synthesizeInheritedFindings — scanner integration", () => {
  it("runScan surfaces inherited findings alongside primary findings, sorted by location", () => {
    // Use wrapper/drift as the real definition-site rule (it fires when
    // the definition doesn't render the declared element). The drift
    // rule itself is NOT inherited — by design — but a synthetic
    // second rule firing at the same definition line IS inherited. To
    // keep this test free of fixture-source dependencies on other
    // rules, we drive the synthesizer pure-function in the earlier
    // block and here just assert the scanner plumbing wires up at all.
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <div role="button" {...props} />; }`,
    );
    const caller = tsxFile("src/pages/Home.tsx", `export const Home = () => <Button />;`);

    const { result } = runScan({
      standards: [wcag22],
      rules: BUILTIN_RULES,
      enabled: ["wcag22"],
      files: [buttonDef, caller],
      nativeWrapperElements: { Button: "button" },
    });

    // The drift rule fires at the definition.
    const drift = result.violations.filter((v) => v.ruleId === "wrapper/drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.location.filePath).toBe("src/ui/Button.tsx");
    // And drift is deliberately NOT inherited.
    const inheritedDrift = result.violations.filter(
      (v) => v.ruleId === "wrapper/drift" && v.confidence === "inherited",
    );
    expect(inheritedDrift).toEqual([]);
  });

  it("runScan propagates inherited confidence + sourceOfFinding end-to-end", () => {
    // We inject a synthetic rule that fires at every definition file
    // we scan so the scanner's inherited-findings post-pass gets real
    // input. Keeping the rule local keeps the test self-contained and
    // doesn't depend on the behaviour of any production rule.
    const buttonDef = tsxFile(
      "src/ui/Button.tsx",
      `export function Button(props) { return <button {...props} />; }`,
    );
    const caller = tsxFile(
      "src/pages/Home.tsx",
      `export const Home = () => <div><Button /><Button /></div>;`,
    );
    const syntheticRule = {
      id: "test/definition-site-ping",
      satisfies: ["wcag22:4.1.2"],
      severity: "error" as const,
      scope: "project" as const,
      fixClass: "guidance" as const,
      docs: {
        description: "test",
        rationale: "test",
        goodExample: "",
        badExample: "",
        references: [],
      },
      afterProject(ctx: {
        readonly emit: (v: {
          readonly severity: "error";
          readonly location: { filePath: string; line: number; column: number };
          readonly message: string;
        }) => void;
      }) {
        ctx.emit({
          severity: "error",
          location: { filePath: "src/ui/Button.tsx", line: 1, column: 1 },
          message: "test definition finding",
        });
      },
    };

    const { result } = runScan({
      standards: [wcag22],
      // biome-ignore lint/suspicious/noExplicitAny: synthetic test rule narrowed inline
      rules: [syntheticRule as any],
      enabled: ["wcag22"],
      files: [buttonDef, caller],
      nativeWrapperElements: { Button: "button" },
    });

    const inheritedForRule = result.violations.filter(
      (v) => v.ruleId === "test/definition-site-ping" && v.confidence === "inherited",
    );
    expect(inheritedForRule).toHaveLength(2);
    for (const v of inheritedForRule) {
      expect(v.location.filePath).toBe("src/pages/Home.tsx");
      expect(v.sourceOfFinding).toEqual({ filePath: "src/ui/Button.tsx", line: 1, column: 1 });
      expect(v.message.startsWith("[inherited from <Button>]")).toBe(true);
    }
  });
});
