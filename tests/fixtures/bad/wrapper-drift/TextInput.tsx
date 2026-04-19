// Declared in ra11y.config.ts: nativeWrappers: { TextInput: "input" }
// Definition drifted to <textarea>. Rule emits once here, pointing the
// agent at a single source-of-truth location rather than noising each
// <TextInput> call site.
import type { TextareaHTMLAttributes } from "react";

export function TextInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}
