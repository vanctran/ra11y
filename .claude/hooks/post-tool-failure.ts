#!/usr/bin/env bun

// PostToolUseFailure. Non-blocking — just records the failure to the
// audit log so we can diagnose autonomous runs later. The tool has
// already failed by the time we see this; Claude will see the error.

import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { ok } from "./lib/output.ts";
import type { PostToolUseFailureInput } from "./lib/types.ts";

const input = await readHookInput<PostToolUseFailureInput>();

audit({
  event: "PostToolUseFailure",
  action: "record",
  detail: {
    tool: input.tool_name,
    error: input.error.slice(0, 500),
    interrupt: input.is_interrupt ?? false,
  },
});

ok();
