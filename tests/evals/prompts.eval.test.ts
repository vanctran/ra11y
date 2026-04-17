/**
 * Prompt-eval test suite — picked up by `bun test`. Per-fixture
 * render+roundtrip checks, plus parity assertions that keep the
 * scripted host aligned with real `sample()` gating semantics.
 */

import { describe, expect, it } from "bun:test";
import { BUILTIN_PROMPTS } from "../../src/mcp/prompts/index.ts";
import { SamplingNotSupportedError, sample } from "../../src/mcp/sampling.ts";
import { PROMPT_FIXTURES } from "./fixtures/index.ts";
import { evaluateAll, evaluateFixture, findPrompt, renderText } from "./harness.ts";
import { cannedText, createScriptedHost, promptToSamplingRequest } from "./scripted-host.ts";

describe("prompt-eval fixture coverage", () => {
  it("every built-in prompt has at least one fixture", () => {
    const covered = new Set(PROMPT_FIXTURES.map((f) => f.promptName));
    const missing = BUILTIN_PROMPTS.filter((p) => !covered.has(p.name)).map((p) => p.name);
    expect(missing).toEqual([]);
  });

  it("every fixture references a real prompt", () => {
    for (const fixture of PROMPT_FIXTURES) {
      expect(() => findPrompt(fixture.promptName)).not.toThrow();
    }
  });
});

describe("prompt-eval per-fixture checks", () => {
  for (const fixture of PROMPT_FIXTURES) {
    it(`${fixture.label}`, async () => {
      const outcome = await evaluateFixture(fixture);
      if (!outcome.passed) {
        const detail = outcome.failures.map((f) => `[${f.kind}] ${f.detail}`).join("; ");
        throw new Error(
          `fixture "${fixture.label}" failed: ${detail}\n---\n${outcome.renderedText}`,
        );
      }
      expect(outcome.passed).toBe(true);
    });
  }
});

describe("prompt-eval aggregate report", () => {
  it("produces matching total/passed/failed counts", async () => {
    const report = await evaluateAll(PROMPT_FIXTURES);
    expect(report.total).toBe(PROMPT_FIXTURES.length);
    expect(report.passed + report.failed).toBe(report.total);
    expect(report.passed).toBe(PROMPT_FIXTURES.length);
  });
});

describe("scripted-host parity with real sample() gating", () => {
  const mkReq = () =>
    promptToSamplingRequest([{ role: "user", content: { type: "text", text: "hi" } }]);

  it("matches SamplingNotSupportedError when the host didn't declare `sampling`", async () => {
    const bare = createScriptedHost().withoutSampling();
    await expect(sample(bare, mkReq())).rejects.toBeInstanceOf(SamplingNotSupportedError);
  });

  it("rejects when no canned response is queued so tests fail loud, not hang", async () => {
    const host = createScriptedHost();
    await expect(sample(host.session, mkReq())).rejects.toThrow(/no canned response queued/);
  });

  it("returns the queued canned response and records the outbound call", async () => {
    const host = createScriptedHost();
    host.enqueue(cannedText("scripted-reply"));
    const messages = findPrompt("ra11y/triage").render({});
    const result = await sample(host.session, promptToSamplingRequest(messages));
    expect(result.content.text).toBe("scripted-reply");
    expect(host.calls[0]?.method).toBe("sampling/createMessage");
  });

  it("renderText concatenates multi-message prompts (future-proofing)", () => {
    const out = renderText([
      { role: "user", content: { type: "text", text: "alpha" } },
      { role: "assistant", content: { type: "text", text: "beta" } },
    ]);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });
});
