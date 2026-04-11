import { describe, expect, it } from "bun:test";
import { parseArgs } from "../../../src/utils/args.ts";

describe("utils/args parseArgs", () => {
  it("parses positional arguments", () => {
    const r = parseArgs(["src", "tests"]);
    expect(r.positionals).toEqual(["src", "tests"]);
    expect(r.options).toEqual({});
  });

  it("parses --key value", () => {
    const r = parseArgs(["--format", "sarif"]);
    expect(r.options["format"]).toBe("sarif");
  });

  it("parses --key=value", () => {
    const r = parseArgs(["--format=sarif"]);
    expect(r.options["format"]).toBe("sarif");
  });

  it("treats listed flags as booleans without consuming the next arg", () => {
    const r = parseArgs(["--verbose", "src"], { flags: ["verbose"] });
    expect(r.options["verbose"]).toBe(true);
    expect(r.positionals).toEqual(["src"]);
  });

  it("expands short aliases to their long form", () => {
    const r = parseArgs(["-f", "json"], { aliases: { f: "format" } });
    expect(r.options["format"]).toBe("json");
  });

  it("handles -fvalue (attached value)", () => {
    const r = parseArgs(["-fjson"], { aliases: { f: "format" } });
    expect(r.options["format"]).toBe("json");
  });

  it("accumulates repeatable flags into an array", () => {
    const r = parseArgs(["--ignore", "dist", "--ignore", "build"], { repeatable: ["ignore"] });
    expect(r.options["ignore"]).toEqual(["dist", "build"]);
  });

  it("treats -- as a sentinel: everything after is positional", () => {
    const r = parseArgs(["--", "--verbose", "src"]);
    expect(r.positionals).toEqual(["--verbose", "src"]);
    expect(r.options).toEqual({});
  });

  it("leaves unknown long options as boolean when not followed by a value", () => {
    const r = parseArgs(["--unknown"]);
    expect(r.options["unknown"]).toBe(true);
  });

  it("combines all the above", () => {
    const r = parseArgs(
      ["-f", "terminal", "--verbose", "--ignore", "dist", "--ignore=build", "src/"],
      { flags: ["verbose"], aliases: { f: "format" }, repeatable: ["ignore"] },
    );
    expect(r.options["format"]).toBe("terminal");
    expect(r.options["verbose"]).toBe(true);
    expect(r.options["ignore"]).toEqual(["dist", "build"]);
    expect(r.positionals).toEqual(["src/"]);
  });
});
