// Declared in ra11y.config.ts: nativeWrappers: { TextInput: "input" }
// Definition renders a real <input>. Case-insensitive match holds.
import type { InputHTMLAttributes } from "react";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} />;
}
