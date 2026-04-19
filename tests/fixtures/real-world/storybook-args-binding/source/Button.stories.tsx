import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  component: Button,
  title: "components/Button",
};
export default meta;

/**
 * Story whose `args.label` is a literal string and whose
 * `args.disabled` is a literal `true`. Without storybook-args
 * synthesis the tsx parser sees no JSX element here, so the wrapper
 * `Button` does not enter the opaque-component inventory and the
 * interactive-attribute heuristic has nothing to consider — the
 * scan-confidence meta tells the agent "we never saw Button rendered."
 *
 * With synthesis, a virtual `<Button label="Save" disabled={true} />`
 * enters the element stream. The opaque-component accumulator counts
 * `Button` once and the `disabled` attribute (in INTERACTIVE_ATTRS)
 * flips its interactive flag, so the entry is eligible for
 * `opaqueCustomComponentsTop`. The fixture's meta-field assertions
 * lock that wiring against regression of the synthesis pass.
 */
export const Disabled: StoryObj<typeof Button> = {
  args: {
    label: "Save",
    disabled: true,
  },
};
