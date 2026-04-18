/**
 * Rule: forms/required-indicator-missing
 * Satisfies: wcag22:3.3.2, wcag21:3.3.2
 * Spec: https://www.w3.org/TR/WCAG22/#labels-or-instructions
 *
 * > Labels or instructions are provided when content requires user input.
 *
 * Fires on a JSX component *definition* (not a call site) that accepts a
 * `required` prop, forwards it to a native `<input>` / `<textarea>` /
 * `<select>`, but then renders neither:
 *   1. a visible required indicator in the component body (an `*`, the
 *      literal text `required`, or an `<abbr title="required">`), nor
 *   2. `aria-required` on the native element.
 *
 * Why the wrapper definition, not the call site? The component
 * definition is where the accessibility pattern is codified: every call
 * site inherits the definition's shape. Flagging at the callsite would
 * emit N findings for one bug and would miss authors who never looked at
 * a consumer. Flagging at the definition sends the fix to the one file
 * that can fix it for everyone.
 *
 * Detection helpers live in `./required-indicator-detection.ts` to keep
 * each file under the commit-size cap.
 */

import { defineRule } from "../../api/plugin.ts";
import type { TsxModule } from "../../types/ast.ts";
import { analyze } from "./required-indicator-detection.ts";

export const rule = defineRule({
  id: "forms/required-indicator-missing",
  satisfies: ["wcag22:3.3.2", "wcag21:3.3.2"],
  severity: "error",
  scope: "document",
  fixClass: "verify-in-source",
  appliesTo: {
    fileExtensions: [".tsx", ".jsx"],
  },
  docs: {
    description:
      "Component wrappers that forward a `required` prop to a native form control must render a visible required indicator or set aria-required.",
    rationale:
      "The `required` HTML attribute blocks submission but is not announced reliably across assistive tech. Screen-reader users and sighted users both need an up-front cue ('this field is required') to avoid submit-then-recover loops. Fixing this at the wrapper definition propagates the fix to every consumer — fixing it at call sites does not.",
    goodExample: `function EmailField({ required, ...rest }: Props) {
  return (
    <label>
      Email {required && <span aria-hidden="true">*</span>}
      <input type="email" required={required} aria-required={required} {...rest} />
    </label>
  );
}`,
    badExample: `function EmailField({ required, ...rest }: Props) {
  return (
    <label>
      Email
      <input type="email" required={required} {...rest} />
    </label>
  );
}`,
    normativeQuote: "Labels or instructions are provided when content requires user input.",
    references: [
      "https://www.w3.org/TR/WCAG22/#labels-or-instructions",
      "https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html",
      "https://www.w3.org/WAI/WCAG22/Techniques/general/G131",
    ],
  },
  afterFile(ctx) {
    if (ctx.language !== "tsx" && ctx.language !== "jsx") return;
    const module = ctx.ast as TsxModule;
    for (const finding of analyze(ctx.source, module)) {
      ctx.emit({
        severity: "error",
        location: { filePath: "", line: finding.line, column: finding.column },
        message: finding.message,
        suggestion: finding.suggestion,
      });
    }
  },
});
