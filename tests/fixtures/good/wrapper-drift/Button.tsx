// Declared in ra11y.config.ts: nativeWrappers: { Button: "button" }
// Definition renders a real <button>. No drift.
import type { ButtonHTMLAttributes } from "react";

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} />;
}
