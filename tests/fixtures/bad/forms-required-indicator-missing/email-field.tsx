interface Props {
  readonly required: boolean;
  readonly id: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
}

/**
 * Fails SC 3.3.2: forwards `required` to a native <input> but renders
 * no visible marker and no aria-required. Users won't know the field
 * is required until the form rejects submission.
 */
export function EmailField({ required, id, value, onChange }: Props) {
  return (
    <label htmlFor={id}>
      Email
      <input
        id={id}
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}
