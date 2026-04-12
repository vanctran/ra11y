/**
 * Evaluation prompts for assisted manual review.
 *
 * Maps criterion IDs to structured prompts that AI agents or human reviewers
 * can use to evaluate accessibility compliance at flagged locations.
 *
 * Tier 1: Agent can make pass/fail judgment with full evaluation prompt.
 * Tier 2: Agent can flag location but human makes the final call.
 * Tier 3: Human-only evaluation required.
 *
 * Spec: https://www.w3.org/TR/WCAG22/
 */

/** Structured evaluation prompt for a manual review criterion. */
export interface EvaluationPrompt {
  readonly tier: 1 | 2 | 3;
  readonly question: string;
  readonly passCriteria: string;
  readonly failExample?: string;
  readonly passExample?: string;
  readonly suggestedFix: string;
}

// ─── Tier 1 prompts (agent-evaluable) ───────────────────────────────────────

const SENSORY_CHARACTERISTICS: EvaluationPrompt = {
  tier: 1,
  question:
    "Does this text rely solely on sensory characteristics (shape, color, size, visual location) to identify a component, without also providing a text name?",
  passCriteria:
    "The instruction names the control by its label or programmatic role, not just color/shape/location",
  suggestedFix:
    "Rewrite to include the control's visible text label alongside any sensory description",
};

const USE_OF_COLOR: EvaluationPrompt = {
  tier: 1,
  question:
    "Is color the only visual means used to convey information here, with no accompanying text, icon, or pattern?",
  passCriteria:
    "Every place color carries meaning also provides a second non-color cue: text label, icon, border, or pattern",
  suggestedFix:
    "Add a non-color visual cue (icon with accessible name, text label, or border/pattern)",
};

const IMAGES_OF_TEXT: EvaluationPrompt = {
  tier: 1,
  question:
    "Does this element render text as an image where CSS-rendered text could achieve the same visual result?",
  passCriteria:
    "Text is rendered via actual text nodes styled with CSS, or the image is a logotype",
  suggestedFix: "Replace with a styled text element using CSS custom fonts",
};

const NO_KEYBOARD_TRAP: EvaluationPrompt = {
  tier: 1,
  question:
    "Can keyboard focus become trapped inside this component with no way to Tab or Escape out?",
  passCriteria:
    "Tab/Shift+Tab exit naturally, or this is a modal dialog with Escape key handling that returns focus to the trigger",
  suggestedFix:
    "Add Escape key handling that returns focus to the trigger element, or remove Tab key interception",
};

const TIMING_ADJUSTABLE: EvaluationPrompt = {
  tier: 1,
  question:
    "Does this component enforce a time limit that cannot be turned off, adjusted, or extended by the user?",
  passCriteria:
    "Time limits have a UI mechanism to turn off, adjust (>=10x), or extend (>=20sec warning, >=3 extensions)",
  suggestedFix: "Add a warning dialog before expiry with an 'Extend session' button",
};

const ON_FOCUS: EvaluationPrompt = {
  tier: 1,
  question:
    "Does receiving focus on this element automatically trigger a context change (navigation, form submission, new window)?",
  passCriteria:
    "The onFocus handler only updates local UI state (highlighting, tooltips) — no navigation, submission, or window opening",
  suggestedFix:
    "Move the context-changing action to onClick or onChange so it requires explicit user action beyond focus",
};

const ON_INPUT: EvaluationPrompt = {
  tier: 1,
  question:
    "Does changing this input's value automatically cause a context change without prior user warning?",
  passCriteria:
    "onChange does not trigger context change, OR visible text warns users before interaction that changing this control will cause navigation",
  suggestedFix:
    "Add a submit button to require explicit action, or add visible warning text before the control",
};

const REDUNDANT_ENTRY: EvaluationPrompt = {
  tier: 1,
  question:
    "In this multi-step process, is information already entered required to be typed again without being auto-populated?",
  passCriteria:
    "Previously entered information is pre-populated, shown read-only, or offered via a 'Same as...' option",
  suggestedFix: "Pre-populate from previously entered data or add a 'Same as [previous]' checkbox",
};

const ACCESSIBLE_AUTH_MINIMUM: EvaluationPrompt = {
  tier: 1,
  question:
    "Does this authentication flow require a cognitive function test (text CAPTCHA, math puzzle) with no alternative method?",
  passCriteria:
    "Login is possible via passkey/WebAuthn, SSO, or password manager — or CAPTCHA uses object recognition",
  suggestedFix:
    "Add passkey/WebAuthn authentication or replace text CAPTCHA with object-recognition alternative",
};

const ACCESSIBLE_AUTH_ENHANCED: EvaluationPrompt = {
  tier: 1,
  question:
    "Does this authentication require ANY cognitive function test, including object-recognition?",
  passCriteria:
    "A completely test-free authentication path exists (passkey, SSO, biometric, or password field)",
  suggestedFix: "Provide a cognitive-function-test-free path such as passkey/WebAuthn or SSO",
};

// ─── Tier 2 prompts (agent flags, human decides) ───────────────────────────

const AUDIO_VIDEO_ALTERNATIVE: EvaluationPrompt = {
  tier: 2,
  question: "Does this audio/video have a transcript or text alternative?",
  passCriteria:
    "A text transcript or media alternative is provided adjacent to or linked from the media element",
  suggestedFix: "Add a transcript link adjacent to the media element",
};

const AUDIO_DESCRIPTION: EvaluationPrompt = {
  tier: 2,
  question: "Does this video have audio descriptions of visual content?",
  passCriteria:
    "Important visual information is described in an audio track or a separate audio description track",
  suggestedFix: "Add <track kind='descriptions' src='descriptions.vtt'>",
};

const ERROR_IDENTIFICATION: EvaluationPrompt = {
  tier: 2,
  question: "Are form errors identified in text and associated with the field?",
  passCriteria:
    "Error messages are presented in text and programmatically associated with the relevant input via aria-describedby or equivalent",
  suggestedFix: "Add specific error text via aria-describedby",
};

const ERROR_SUGGESTION: EvaluationPrompt = {
  tier: 2,
  question: "Do error messages include suggestions for correction?",
  passCriteria:
    "Error messages describe the expected format or provide specific correction guidance",
  suggestedFix: "Add format guidance to error messages",
};

// ─── Prompt registry ────────────────────────────────────────────────────────

const ENTRIES: readonly (readonly [string, EvaluationPrompt])[] = [
  // Tier 1 — wcag22
  ["wcag22:1.3.3", SENSORY_CHARACTERISTICS],
  ["wcag22:1.4.1", USE_OF_COLOR],
  ["wcag22:1.4.5", IMAGES_OF_TEXT],
  ["wcag22:2.1.2", NO_KEYBOARD_TRAP],
  ["wcag22:2.2.1", TIMING_ADJUSTABLE],
  ["wcag22:3.2.1", ON_FOCUS],
  ["wcag22:3.2.2", ON_INPUT],
  ["wcag22:3.3.7", REDUNDANT_ENTRY],
  ["wcag22:3.3.8", ACCESSIBLE_AUTH_MINIMUM],
  ["wcag22:3.3.9", ACCESSIBLE_AUTH_ENHANCED],
  // Tier 1 — wcag21 equivalents
  ["wcag21:1.3.3", SENSORY_CHARACTERISTICS],
  ["wcag21:1.4.1", USE_OF_COLOR],
  ["wcag21:1.4.5", IMAGES_OF_TEXT],
  ["wcag21:2.1.2", NO_KEYBOARD_TRAP],
  ["wcag21:2.2.1", TIMING_ADJUSTABLE],
  ["wcag21:3.2.1", ON_FOCUS],
  ["wcag21:3.2.2", ON_INPUT],
  // Tier 2 — wcag22
  ["wcag22:1.2.1", AUDIO_VIDEO_ALTERNATIVE],
  ["wcag22:1.2.5", AUDIO_DESCRIPTION],
  ["wcag22:3.3.1", ERROR_IDENTIFICATION],
  ["wcag22:3.3.3", ERROR_SUGGESTION],
  // Tier 2 — wcag21 equivalents
  ["wcag21:1.2.1", AUDIO_VIDEO_ALTERNATIVE],
  ["wcag21:1.2.5", AUDIO_DESCRIPTION],
  ["wcag21:3.3.1", ERROR_IDENTIFICATION],
  ["wcag21:3.3.3", ERROR_SUGGESTION],
];

/** Evaluation prompts keyed by criterion ID (e.g., "wcag22:1.4.1"). */
export const EVALUATION_PROMPTS: ReadonlyMap<string, EvaluationPrompt> = new Map(ENTRIES);
