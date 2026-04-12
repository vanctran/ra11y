// Shared types for ra11y's Claude Code hooks.
// These mirror the schema documented at https://code.claude.com/docs/en/hooks.
// They are intentionally loose: we capture only the fields our hooks use and
// treat the rest as unknown so upstream schema changes never crash the hook.

export type PermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

export interface CommonHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: PermissionMode;
  hook_event_name: string;
  agent_id?: string;
  agent_type?: string;
}

export interface SessionStartInput extends CommonHookInput {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear" | "compact";
  model?: string;
}

export interface UserPromptSubmitInput extends CommonHookInput {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

export interface PreToolUseInput extends CommonHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface PostToolUseInput extends CommonHookInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
}

export interface PostToolUseFailureInput extends CommonHookInput {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  error: string;
  is_interrupt?: boolean;
}

export interface SubagentStopInput extends CommonHookInput {
  hook_event_name: "SubagentStop";
  stop_hook_active: boolean;
  agent_id: string;
  agent_type: string;
  agent_transcript_path: string;
  last_assistant_message: string;
}

export interface StopInput extends CommonHookInput {
  hook_event_name: "Stop";
}

export interface NotificationInput extends CommonHookInput {
  hook_event_name: "Notification";
  message: string;
  title?: string;
  notification_type: "permission_prompt" | "idle_prompt" | "auth_success" | "elicitation_dialog";
}

export interface InstructionsLoadedInput extends CommonHookInput {
  hook_event_name: "InstructionsLoaded";
  file_path: string;
  memory_type: "User" | "Project" | "Local" | "Managed";
  load_reason: "session_start" | "nested_traversal" | "path_glob_match" | "include" | "compact";
  globs?: string[];
}

// Universal output fields. Event-specific fields go in `hookSpecificOutput`.
export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: Record<string, unknown> & { hookEventName: string };
}

export interface AuditEntry {
  ts: string;
  event: string;
  agent?: string | undefined;
  action: string;
  detail?: Record<string, unknown>;
}
