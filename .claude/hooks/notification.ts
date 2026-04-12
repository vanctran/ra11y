#!/usr/bin/env bun

// Notification hook. Non-blocking. Fires on idle_prompt (Claude is
// waiting for the user). Emits a terminal bell — visible in most
// terminal emulators and usable by the default bell-indicator hooks
// in macOS / Linux / Windows Terminal.

import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { ok } from "./lib/output.ts";
import type { NotificationInput } from "./lib/types.ts";

const input = await readHookInput<NotificationInput>();

if (input.notification_type === "idle_prompt") {
  process.stdout.write("\u0007"); // BEL
}

audit({
  event: "Notification",
  action: "record",
  detail: { type: input.notification_type, title: input.title },
});

ok();
