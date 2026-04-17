/**
 * MCP prompt template types.
 *
 * A `Prompt` is a reusable instruction template the server advertises via
 * `prompts/list` and renders on `prompts/get`. The shape mirrors MCP's
 * prompts capability: a `name`, a human-facing `description`, an optional
 * typed `arguments` list, and a `render` function that produces the
 * `messages` array the host injects.
 *
 * Templates are plain TS — no template engine, no YAML, no handlebars.
 * `render` returns the fully substituted text; callers pass a
 * `Record<string, string>` of arguments so bracket access stays
 * index-signature safe.
 */
export interface PromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export interface PromptMessage {
  readonly role: "user" | "assistant";
  readonly content: { readonly type: "text"; readonly text: string };
}

export interface Prompt {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly PromptArgument[];
  readonly render: (args: Readonly<Record<string, string>>) => readonly PromptMessage[];
}
