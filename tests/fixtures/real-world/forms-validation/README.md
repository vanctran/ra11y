# forms-validation fixture

Guards the full forms-validation surface: four static rules and three review finders on a sanitized two-file React contact form.

## What this fixture guards

| Rule / finder | Source trigger |
|---|---|
| `forms/labels-required` | `<input type="email">` in `ContactForm.tsx` with no label, no aria-label |
| `forms/fieldset-legend` | `<fieldset>` wrapping checkboxes with no `<legend>` child |
| `forms/required-indicator-missing` | `PhoneField.tsx` forwards `required` prop to `<input>` without marker or aria-required |
| `forms/autocomplete-missing` | email input (ContactForm) and tel input (PhoneField) lack `autocomplete` |
| `review/validation-timing` (wcag22:3.3.3) | name `<input>` onChange inline arrow calls `setErrors` per keystroke |
| `review/server-error-untied` (wcag22:3.3.1) | `<p role="alert">` beside a `<input>` with no `aria-invalid` and no `id` |
| `review/error-identification` (wcag22:3.3.1) | notes `<input aria-invalid="true">` with no `aria-describedby` or `aria-errormessage` |

## Commit guarded

Synthetic fixture authored 2026-04-19. No single commit — guards the combined forms surface against silent regression after engine refactors.

## Sanitization

Brand names, field labels, and copy replaced with neutral equivalents (name/email/phone/notes/subject). No real API keys or identifying strings. Structure preserved faithfully.

## Live meta evidence

Probe run 2026-04-19: all seven assertions green. `wcag22:3.3.1` receives two distinct candidates from two different finders (server-error-untied and error-identification) — both `reasonIncludes` substrings are disjoint and match exactly one finder each.
