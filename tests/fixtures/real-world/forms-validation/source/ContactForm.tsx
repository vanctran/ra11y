/**
 * ContactForm — sanitized form component exercising the full
 * validation/labeling surface:
 *
 *   - Labeled name input with inline onChange that calls setErrors
 *     (triggers review/validation-timing on wcag22:3.3.3)
 *   - Unlabeled email input (triggers forms/labels-required)
 *   - Email input without autocomplete (triggers forms/autocomplete-missing)
 *   - Fieldset without legend (triggers forms/fieldset-legend)
 *   - p role="alert" beside an input with no aria-invalid/aria-describedby
 *     (triggers review/server-error-untied on wcag22:3.3.1)
 *   - input with aria-invalid="true" and no aria-describedby or aria-errormessage
 *     (triggers review/error-identification on wcag22:3.3.1)
 */

import { useState } from "react";

interface ContactFormProps {
  onSubmit: (data: { name: string; email: string }) => Promise<void>;
}

export function ContactForm({ onSubmit }: ContactFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setErrors] = useState<Record<string, string>>({});
  const [serverMessage, setServerMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await onSubmit({ name, email });
    } catch {
      setServerMessage("Submission failed. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Name field — labeled, but onChange runs setErrors on every keystroke.
          Inline arrow body with setErrors call triggers review/validation-timing. */}
      <label htmlFor="contact-name">Name</label>
      <input
        id="contact-name"
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setErrors({ name: e.target.value.length < 2 ? "Name too short" : "" });
        }}
      />

      {/* Email field — NO label, NO autocomplete.
          Triggers: forms/labels-required, forms/autocomplete-missing */}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      {/* Server error region beside an unwired input.
          The p[role=alert] fires review/server-error-untied because the
          sibling <input> has no aria-invalid and no id (no aria-describedby
          can point at the alert). */}
      <div>
        <p role="alert">{serverMessage}</p>
        <input
          type="text"
          name="subject"
          value=""
          onChange={() => {}}
        />
      </div>

      {/* Input marked invalid but no aria-describedby or aria-errormessage.
          Triggers review/error-identification. */}
      <label htmlFor="contact-notes">Notes (optional)</label>
      <input
        id="contact-notes"
        type="text"
        name="notes"
        aria-invalid="true"
      />

      {/* Fieldset without legend.
          Triggers forms/fieldset-legend. */}
      <fieldset>
        <label>
          <input type="checkbox" name="newsletter" />
          Subscribe to newsletter
        </label>
        <label>
          <input type="checkbox" name="updates" />
          Product updates
        </label>
      </fieldset>

      <button type="submit">Send</button>
    </form>
  );
}
