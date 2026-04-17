/**
 * Prompt-eval runner. For each `PromptFixture`: render, check
 * anchors/forbidden/ordered-steps in the text, then round-trip the
 * messages through `sample()` against a scripted host to prove the
 * shape is a valid `SamplingRequest`. No model involved.
 */

import { BUILTIN_PROMPTS, type PromptMessage } from "../../src/mcp/prompts/index.ts";
import { sample } from "../../src/mcp/sampling.ts";
import type { PromptFixture } from "./fixtures/index.ts";
import { cannedText, createScriptedHost, promptToSamplingRequest } from "./scripted-host.ts";

export interface CheckFailure {
  readonly kind: "missing-anchor" | "forbidden-anchor" | "step-out-of-order" | "roundtrip";
  readonly detail: string;
}

export interface EvalOutcome {
  readonly label: string;
  readonly promptName: string;
  readonly passed: boolean;
  readonly failures: readonly CheckFailure[];
  readonly renderedText: string;
}

export interface EvalReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly outcomes: readonly EvalOutcome[];
}

/** Locate a prompt by name. Throws when renamed/removed so drift surfaces here. */
export function findPrompt(name: string) {
  const found = BUILTIN_PROMPTS.find((p) => p.name === name);
  if (!found) throw new Error(`prompt-evals: no built-in prompt named "${name}"`);
  return found;
}

/** Join all messages so anchor checks work for multi-message prompts too. */
export function renderText(messages: readonly PromptMessage[]): string {
  return messages.map((m) => m.content.text).join("\n\n");
}

function checkPresence(
  text: string,
  items: readonly string[],
  shouldAppear: boolean,
  kind: "missing-anchor" | "forbidden-anchor",
): CheckFailure[] {
  const out: CheckFailure[] = [];
  for (const s of items) {
    if (text.includes(s) !== shouldAppear) out.push({ kind, detail: s });
  }
  return out;
}

function checkOrdered(text: string, steps: readonly string[]): CheckFailure[] {
  let cursor = 0;
  for (const step of steps) {
    const idx = text.indexOf(step, cursor);
    if (idx < 0) {
      return [
        {
          kind: "step-out-of-order",
          detail: `step marker "${step}" missing or out of order`,
        },
      ];
    }
    cursor = idx + step.length;
  }
  return [];
}

/**
 * Feed the rendered messages through `sample()` with a scripted host.
 * Checks the outbound call hit `sampling/createMessage` with the
 * messages forwarded verbatim and the canned result flowed back.
 */
async function roundtrip(messages: readonly PromptMessage[]): Promise<CheckFailure[]> {
  const host = createScriptedHost();
  host.enqueue(cannedText("ok"));
  try {
    const result = await sample(host.session, promptToSamplingRequest(messages));
    if (result.content.text !== "ok") {
      return [{ kind: "roundtrip", detail: `unexpected canned echo: ${result.content.text}` }];
    }
    const call = host.calls[0];
    if (host.calls.length !== 1 || call?.method !== "sampling/createMessage") {
      return [{ kind: "roundtrip", detail: `expected 1 createMessage, got ${host.calls.length}` }];
    }
    const params = call.params as { messages?: unknown };
    if (!Array.isArray(params.messages) || params.messages.length !== messages.length) {
      return [{ kind: "roundtrip", detail: "messages not forwarded verbatim" }];
    }
    return [];
  } catch (err) {
    return [{ kind: "roundtrip", detail: `sample() threw: ${(err as Error).message}` }];
  }
}

export async function evaluateFixture(fixture: PromptFixture): Promise<EvalOutcome> {
  const prompt = findPrompt(fixture.promptName);
  const messages = prompt.render(fixture.args);
  const text = renderText(messages);
  const failures: CheckFailure[] = [
    ...checkPresence(text, fixture.anchors, true, "missing-anchor"),
    ...checkPresence(text, fixture.forbiddenAnchors ?? [], false, "forbidden-anchor"),
    ...(fixture.orderedSteps ? checkOrdered(text, fixture.orderedSteps) : []),
    ...(await roundtrip(messages)),
  ];
  return {
    label: fixture.label,
    promptName: fixture.promptName,
    passed: failures.length === 0,
    failures,
    renderedText: text,
  };
}

export async function evaluateAll(fixtures: readonly PromptFixture[]): Promise<EvalReport> {
  const outcomes: EvalOutcome[] = [];
  for (const fixture of fixtures) outcomes.push(await evaluateFixture(fixture));
  const passed = outcomes.filter((o) => o.passed).length;
  return { total: outcomes.length, passed, failed: outcomes.length - passed, outcomes };
}
