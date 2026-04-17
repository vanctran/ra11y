/**
 * Barrel export for MCP prompt templates.
 *
 * `BUILTIN_PROMPTS` is the canonical inventory the server advertises
 * via `prompts/list` and renders via `prompts/get`. Each entry is
 * self-contained — no shared state, no template engine — so adding a
 * prompt means: write the file, export it here, ship.
 */
import { auditPrompt } from "./audit.ts";
import { fixPrompt } from "./fix.ts";
import { triagePrompt } from "./triage.ts";
import type { Prompt } from "./types.ts";
import { vpatNarrativePrompt } from "./vpat-narrative.ts";

export type { Prompt, PromptArgument, PromptMessage } from "./types.ts";

export const BUILTIN_PROMPTS: readonly Prompt[] = [
  triagePrompt,
  fixPrompt,
  auditPrompt,
  vpatNarrativePrompt,
];
