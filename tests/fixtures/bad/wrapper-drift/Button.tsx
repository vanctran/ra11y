// Declared in ra11y.config.ts: nativeWrappers: { Button: "button" }
// Definition has drifted to <div role="button"> — call-site
// keyboard/handler-missing and button-name checks are being silenced
// on evidence that no longer holds.
import type { HTMLAttributes } from "react";

export function Button(props: HTMLAttributes<HTMLDivElement>) {
  return <div role="button" {...props} />;
}
