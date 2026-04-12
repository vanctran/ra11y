#!/usr/bin/env bun

// InstructionsLoaded hook. Observability-only. Records which CLAUDE.md
// and rule files loaded in a session so we can diagnose "why didn't the
// agent know about X" after the fact.

import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { ok } from "./lib/output.ts";
import type { InstructionsLoadedInput } from "./lib/types.ts";

const input = await readHookInput<InstructionsLoadedInput>();

audit({
  event: "InstructionsLoaded",
  action: "load",
  detail: {
    file: input.file_path,
    memoryType: input.memory_type,
    reason: input.load_reason,
  },
});

ok();
