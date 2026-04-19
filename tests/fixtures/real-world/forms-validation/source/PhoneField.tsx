/**
 * PhoneField — wrapper component that forwards `required` to a native
 * <input> but renders no visible indicator and no aria-required.
 * Triggers: forms/required-indicator-missing
 */

interface PhoneFieldProps {
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}

export function PhoneField({ required, value, onChange }: PhoneFieldProps) {
  return (
    <label>
      Phone number
      <input
        type="tel"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
