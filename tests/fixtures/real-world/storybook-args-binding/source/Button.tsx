/**
 * Sanitized Button component used by the storybook-args-binding
 * fixture. The shape is what matters — a wrapper component that
 * forwards its props onto a native `<button>` — so the rule
 * `semantics/button-name` fires on the synthesized story render.
 */

interface ButtonProps {
  readonly label?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
}

export function Button({ label, onClick, disabled }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
