interface Props {
  readonly required: boolean;
  readonly id: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
}

/**
 * Passes SC 3.3.2: the required-ness is announced to AT users via
 * aria-required and shown to sighted users via an asterisk gated on
 * the `required` prop.
 */
export function EmailField({ required, id, value, onChange }: Props) {
  return (
    <label htmlFor={id}>
      Email {required && <span aria-hidden="true">*</span>}
      <input
        id={id}
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-required={required}
      />
    </label>
  );
}
