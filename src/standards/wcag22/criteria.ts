/**
 * WCAG 2.2 success criteria as pure data.
 *
 * All 86 success criteria defined by WCAG 2.2. Source:
 * https://www.w3.org/TR/WCAG22/
 *
 * Note on 4.1.1 Parsing: this SC was removed in WCAG 2.2 (always
 * satisfies). We still include it with `automatable: "manual"` and
 * a note in the description so consumers referencing 2.0/2.1 code
 * aren't surprised by a missing ID. Rules that want to target
 * parsing correctness should satisfy both 4.1.1 (historical) and
 * 4.1.2 (current).
 *
 * `automatable` classifications reflect what we can statically check:
 *   - full:     the rule implementation catches every conformance failure
 *   - partial:  the rule catches a meaningful subset; the rest needs manual audit
 *   - manual:   no static check is possible; the criterion requires human judgment
 *
 * `equivalentTo` entries cross-map to WCAG 2.1 and (where applicable) WCAG 2.0.
 * Section 508 and EN 301 549 equivalents are added on those standards' side
 * so this file stays self-contained for WCAG 2.2 readers.
 */

import type { Automatability, Criterion } from "../../types/standard.ts";
import { wcag22Url } from "./metadata.ts";

/**
 * Row shape used to build the criteria list. Exported so WCAG 2.1 can
 * derive its own criteria by filtering this data — 2.1 is literally 2.2
 * minus 9 criteria, and duplicating 78 rows would rot into divergent
 * wording over time.
 */
export interface WcagRow {
  readonly id: string; // local ID like "1.4.3"
  readonly title: string;
  readonly level: "A" | "AA" | "AAA";
  readonly slug: string; // URL anchor
  readonly description: string;
  readonly automatable: Automatability;
  readonly equivalentTo?: readonly string[];
}

/** All 87 WCAG 2.2 rows — the data WCAG22_CRITERIA is built from. */
export const WCAG22_ROWS: readonly WcagRow[] = [
  // =========================================================================
  // Principle 1 — Perceivable
  // =========================================================================

  // 1.1 Text Alternatives
  {
    id: "1.1.1",
    title: "Non-text Content",
    level: "A",
    slug: "non-text-content",
    description:
      "All non-text content has a text alternative that serves the equivalent purpose, except for decorative, controls, sensory tests, CAPTCHAs, and test-specific content.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.1.1"],
  },

  // 1.2 Time-based Media
  {
    id: "1.2.1",
    title: "Audio-only and Video-only (Prerecorded)",
    level: "A",
    slug: "audio-only-and-video-only-prerecorded",
    description:
      "Prerecorded audio-only and video-only media have an alternative (transcript or equivalent).",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.1"],
  },
  {
    id: "1.2.2",
    title: "Captions (Prerecorded)",
    level: "A",
    slug: "captions-prerecorded",
    description: "Captions are provided for all prerecorded audio content in synchronized media.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.2.2"],
  },
  {
    id: "1.2.3",
    title: "Audio Description or Media Alternative (Prerecorded)",
    level: "A",
    slug: "audio-description-or-media-alternative-prerecorded",
    description:
      "An alternative for time-based media or audio description of the prerecorded video content is provided.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.3"],
  },
  {
    id: "1.2.4",
    title: "Captions (Live)",
    level: "AA",
    slug: "captions-live",
    description: "Captions are provided for all live audio content in synchronized media.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.4"],
  },
  {
    id: "1.2.5",
    title: "Audio Description (Prerecorded)",
    level: "AA",
    slug: "audio-description-prerecorded",
    description:
      "Audio description is provided for all prerecorded video content in synchronized media.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.5"],
  },
  {
    id: "1.2.6",
    title: "Sign Language (Prerecorded)",
    level: "AAA",
    slug: "sign-language-prerecorded",
    description: "Sign language interpretation is provided for all prerecorded audio content.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.6"],
  },
  {
    id: "1.2.7",
    title: "Extended Audio Description (Prerecorded)",
    level: "AAA",
    slug: "extended-audio-description-prerecorded",
    description:
      "Where pauses in foreground audio are insufficient to allow audio descriptions to convey the sense of the video, extended audio description is provided.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.7"],
  },
  {
    id: "1.2.8",
    title: "Media Alternative (Prerecorded)",
    level: "AAA",
    slug: "media-alternative-prerecorded",
    description:
      "An alternative for time-based media is provided for all prerecorded synchronized media and for all prerecorded video-only media.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.8"],
  },
  {
    id: "1.2.9",
    title: "Audio-only (Live)",
    level: "AAA",
    slug: "audio-only-live",
    description:
      "An alternative for time-based media that presents equivalent information for live audio-only content is provided.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.2.9"],
  },

  // 1.3 Adaptable
  {
    id: "1.3.1",
    title: "Info and Relationships",
    level: "A",
    slug: "info-and-relationships",
    description:
      "Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.3.1"],
  },
  {
    id: "1.3.2",
    title: "Meaningful Sequence",
    level: "A",
    slug: "meaningful-sequence",
    description:
      "When the sequence of content affects meaning, the sequence can be programmatically determined.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.3.2"],
  },
  {
    id: "1.3.3",
    title: "Sensory Characteristics",
    level: "A",
    slug: "sensory-characteristics",
    description:
      "Instructions do not rely solely on sensory characteristics of components such as shape, color, size, visual location, orientation, or sound.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.3.3"],
  },
  {
    id: "1.3.4",
    title: "Orientation",
    level: "AA",
    slug: "orientation",
    description:
      "Content does not restrict its view and operation to a single display orientation unless a specific orientation is essential.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.3.4"],
  },
  {
    id: "1.3.5",
    title: "Identify Input Purpose",
    level: "AA",
    slug: "identify-input-purpose",
    description:
      "The purpose of each input field collecting information about the user can be programmatically determined via the autocomplete attribute.",
    automatable: "full",
    equivalentTo: ["wcag21:1.3.5"],
  },
  {
    id: "1.3.6",
    title: "Identify Purpose",
    level: "AAA",
    slug: "identify-purpose",
    description:
      "The purpose of user interface components, icons, and regions can be programmatically determined.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.3.6"],
  },

  // 1.4 Distinguishable
  {
    id: "1.4.1",
    title: "Use of Color",
    level: "A",
    slug: "use-of-color",
    description:
      "Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.4.1"],
  },
  {
    id: "1.4.2",
    title: "Audio Control",
    level: "A",
    slug: "audio-control",
    description:
      "If audio plays automatically for more than 3 seconds, a mechanism is available to pause or stop it, or to control its volume independently of the overall system.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.2"],
  },
  {
    id: "1.4.3",
    title: "Contrast (Minimum)",
    level: "AA",
    slug: "contrast-minimum",
    description:
      "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1 (3:1 for large text).",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.3"],
  },
  {
    id: "1.4.4",
    title: "Resize Text",
    level: "AA",
    slug: "resize-text",
    description:
      "Text can be resized without assistive technology up to 200 percent without loss of content or functionality.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.4"],
  },
  {
    id: "1.4.5",
    title: "Images of Text",
    level: "AA",
    slug: "images-of-text",
    description:
      "If the technologies being used can achieve the visual presentation, text is used rather than images of text.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.4.5"],
  },
  {
    id: "1.4.6",
    title: "Contrast (Enhanced)",
    level: "AAA",
    slug: "contrast-enhanced",
    description:
      "The visual presentation of text and images of text has a contrast ratio of at least 7:1 (4.5:1 for large text).",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.6"],
  },
  {
    id: "1.4.7",
    title: "Low or No Background Audio",
    level: "AAA",
    slug: "low-or-no-background-audio",
    description:
      "For prerecorded audio-only content with speech, background sounds are absent or very quiet.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.4.7"],
  },
  {
    id: "1.4.8",
    title: "Visual Presentation",
    level: "AAA",
    slug: "visual-presentation",
    description:
      "For visual presentation of blocks of text, a mechanism is available to achieve specific presentation requirements (color, width, line height, etc.).",
    automatable: "manual",
    equivalentTo: ["wcag21:1.4.8"],
  },
  {
    id: "1.4.9",
    title: "Images of Text (No Exception)",
    level: "AAA",
    slug: "images-of-text-no-exception",
    description:
      "Images of text are only used for pure decoration or where a particular presentation of text is essential to the information.",
    automatable: "manual",
    equivalentTo: ["wcag21:1.4.9"],
  },
  {
    id: "1.4.10",
    title: "Reflow",
    level: "AA",
    slug: "reflow",
    description:
      "Content can be presented without loss of information or functionality, and without requiring two-dimensional scrolling, at widths down to 320 CSS pixels.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.10"],
  },
  {
    id: "1.4.11",
    title: "Non-text Contrast",
    level: "AA",
    slug: "non-text-contrast",
    description:
      "Visual presentation of user interface components and graphical objects has a contrast ratio of at least 3:1 against adjacent colors.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.11"],
  },
  {
    id: "1.4.12",
    title: "Text Spacing",
    level: "AA",
    slug: "text-spacing",
    description:
      "No loss of content or functionality occurs when users override text spacing properties to specified values.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.12"],
  },
  {
    id: "1.4.13",
    title: "Content on Hover or Focus",
    level: "AA",
    slug: "content-on-hover-or-focus",
    description:
      "Additional content that appears on hover or focus is dismissable, hoverable, and persistent.",
    automatable: "partial",
    equivalentTo: ["wcag21:1.4.13"],
  },

  // =========================================================================
  // Principle 2 — Operable
  // =========================================================================

  // 2.1 Keyboard Accessible
  {
    id: "2.1.1",
    title: "Keyboard",
    level: "A",
    slug: "keyboard",
    description:
      "All functionality of the content is operable through a keyboard interface without requiring specific timings for individual keystrokes.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.1.1"],
  },
  {
    id: "2.1.2",
    title: "No Keyboard Trap",
    level: "A",
    slug: "no-keyboard-trap",
    description:
      "If keyboard focus can be moved to a component of the page, then focus can be moved away from that component using only a keyboard interface.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.1.2"],
  },
  {
    id: "2.1.3",
    title: "Keyboard (No Exception)",
    level: "AAA",
    slug: "keyboard-no-exception",
    description:
      "All functionality of the content is operable through a keyboard interface without requiring specific timings for individual keystrokes.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.1.3"],
  },
  {
    id: "2.1.4",
    title: "Character Key Shortcuts",
    level: "A",
    slug: "character-key-shortcuts",
    description:
      "If a keyboard shortcut is implemented using only letter, punctuation, number, or symbol characters, then it can be turned off, remapped, or activated only on focus.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.1.4"],
  },

  // 2.2 Enough Time
  {
    id: "2.2.1",
    title: "Timing Adjustable",
    level: "A",
    slug: "timing-adjustable",
    description:
      "For each time limit that is set by the content, the user can turn off, adjust, or extend the time limit.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.2.1"],
  },
  {
    id: "2.2.2",
    title: "Pause, Stop, Hide",
    level: "A",
    slug: "pause-stop-hide",
    description:
      "For moving, blinking, scrolling, or auto-updating information, users can pause, stop, or hide it.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.2.2"],
  },
  {
    id: "2.2.3",
    title: "No Timing",
    level: "AAA",
    slug: "no-timing",
    description:
      "Timing is not an essential part of the event or activity presented by the content.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.2.3"],
  },
  {
    id: "2.2.4",
    title: "Interruptions",
    level: "AAA",
    slug: "interruptions",
    description: "Interruptions can be postponed or suppressed by the user.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.2.4"],
  },
  {
    id: "2.2.5",
    title: "Re-authenticating",
    level: "AAA",
    slug: "re-authenticating",
    description:
      "When an authenticated session expires, the user can continue the activity without loss of data after re-authenticating.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.2.5"],
  },
  {
    id: "2.2.6",
    title: "Timeouts",
    level: "AAA",
    slug: "timeouts",
    description:
      "Users are warned of the duration of any user inactivity that could cause data loss, unless the data is preserved for more than 20 hours of inactivity.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.2.6"],
  },

  // 2.3 Seizures and Physical Reactions
  {
    id: "2.3.1",
    title: "Three Flashes or Below Threshold",
    level: "A",
    slug: "three-flashes-or-below-threshold",
    description:
      "Web pages do not contain anything that flashes more than three times in any one second period.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.3.1"],
  },
  {
    id: "2.3.2",
    title: "Three Flashes",
    level: "AAA",
    slug: "three-flashes",
    description:
      "Web pages do not contain anything that flashes more than three times in any one second period.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.3.2"],
  },
  {
    id: "2.3.3",
    title: "Animation from Interactions",
    level: "AAA",
    slug: "animation-from-interactions",
    description:
      "Motion animation triggered by interaction can be disabled, unless the animation is essential to the functionality or the information being conveyed.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.3.3"],
  },

  // 2.4 Navigable
  {
    id: "2.4.1",
    title: "Bypass Blocks",
    level: "A",
    slug: "bypass-blocks",
    description:
      "A mechanism is available to bypass blocks of content that are repeated on multiple web pages.",
    automatable: "full",
    equivalentTo: ["wcag21:2.4.1"],
  },
  {
    id: "2.4.2",
    title: "Page Titled",
    level: "A",
    slug: "page-titled",
    description: "Web pages have titles that describe topic or purpose.",
    automatable: "full",
    equivalentTo: ["wcag21:2.4.2"],
  },
  {
    id: "2.4.3",
    title: "Focus Order",
    level: "A",
    slug: "focus-order",
    description:
      "If a web page can be navigated sequentially and the navigation sequences affect meaning or operation, focusable components receive focus in an order that preserves meaning and operability.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.4.3"],
  },
  {
    id: "2.4.4",
    title: "Link Purpose (In Context)",
    level: "A",
    slug: "link-purpose-in-context",
    description:
      "The purpose of each link can be determined from the link text alone or from the link text together with its programmatically determined link context.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.4.4"],
  },
  {
    id: "2.4.5",
    title: "Multiple Ways",
    level: "AA",
    slug: "multiple-ways",
    description:
      "More than one way is available to locate a web page within a set of web pages, except where the web page is the result of, or a step in, a process.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.4.5"],
  },
  {
    id: "2.4.6",
    title: "Headings and Labels",
    level: "AA",
    slug: "headings-and-labels",
    description: "Headings and labels describe topic or purpose.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.4.6"],
  },
  {
    id: "2.4.7",
    title: "Focus Visible",
    level: "AA",
    slug: "focus-visible",
    description:
      "Any keyboard operable user interface has a mode of operation where the keyboard focus indicator is visible.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.4.7"],
  },
  {
    id: "2.4.8",
    title: "Location",
    level: "AAA",
    slug: "location",
    description: "Information about the user's location within a set of web pages is available.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.4.8"],
  },
  {
    id: "2.4.9",
    title: "Link Purpose (Link Only)",
    level: "AAA",
    slug: "link-purpose-link-only",
    description:
      "A mechanism is available to allow the purpose of each link to be identified from link text alone.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.4.9"],
  },
  {
    id: "2.4.10",
    title: "Section Headings",
    level: "AAA",
    slug: "section-headings",
    description: "Section headings are used to organize the content.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.4.10"],
  },
  {
    id: "2.4.11",
    title: "Focus Not Obscured (Minimum)",
    level: "AA",
    slug: "focus-not-obscured-minimum",
    description:
      "When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content.",
    automatable: "manual",
  },
  {
    id: "2.4.12",
    title: "Focus Not Obscured (Enhanced)",
    level: "AAA",
    slug: "focus-not-obscured-enhanced",
    description:
      "When a user interface component receives keyboard focus, no part of the component is hidden by author-created content.",
    automatable: "manual",
  },
  {
    id: "2.4.13",
    title: "Focus Appearance",
    level: "AAA",
    slug: "focus-appearance",
    description:
      "When the keyboard focus indicator is visible, the focus indication has sufficient size and contrast.",
    automatable: "manual",
  },

  // 2.5 Input Modalities
  {
    id: "2.5.1",
    title: "Pointer Gestures",
    level: "A",
    slug: "pointer-gestures",
    description:
      "All functionality that uses multipoint or path-based gestures for operation can be operated with a single pointer without a path-based gesture.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.5.1"],
  },
  {
    id: "2.5.2",
    title: "Pointer Cancellation",
    level: "A",
    slug: "pointer-cancellation",
    description:
      "For functionality that can be operated using a single pointer, the down-event is not used to trigger any part of the function.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.5.2"],
  },
  {
    id: "2.5.3",
    title: "Label in Name",
    level: "A",
    slug: "label-in-name",
    description:
      "For user interface components with labels that include text or images of text, the name contains the text that is presented visually.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.5.3"],
  },
  {
    id: "2.5.4",
    title: "Motion Actuation",
    level: "A",
    slug: "motion-actuation",
    description:
      "Functionality that can be operated by device motion or user motion can also be operated by user interface components and responding to the motion can be disabled.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.5.4"],
  },
  {
    id: "2.5.5",
    title: "Target Size (Enhanced)",
    level: "AAA",
    slug: "target-size-enhanced",
    description: "The size of the target for pointer inputs is at least 44 by 44 CSS pixels.",
    automatable: "partial",
    equivalentTo: ["wcag21:2.5.5"],
  },
  {
    id: "2.5.6",
    title: "Concurrent Input Mechanisms",
    level: "AAA",
    slug: "concurrent-input-mechanisms",
    description:
      "Content does not restrict use of input modalities available on a platform except where the restriction is essential.",
    automatable: "manual",
    equivalentTo: ["wcag21:2.5.6"],
  },
  {
    id: "2.5.7",
    title: "Dragging Movements",
    level: "AA",
    slug: "dragging-movements",
    description:
      "All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging.",
    automatable: "partial",
  },
  {
    id: "2.5.8",
    title: "Target Size (Minimum)",
    level: "AA",
    slug: "target-size-minimum",
    description: "The size of the target for pointer inputs is at least 24 by 24 CSS pixels.",
    automatable: "partial",
  },

  // =========================================================================
  // Principle 3 — Understandable
  // =========================================================================

  // 3.1 Readable
  {
    id: "3.1.1",
    title: "Language of Page",
    level: "A",
    slug: "language-of-page",
    description: "The default human language of each web page can be programmatically determined.",
    automatable: "full",
    equivalentTo: ["wcag21:3.1.1"],
  },
  {
    id: "3.1.2",
    title: "Language of Parts",
    level: "AA",
    slug: "language-of-parts",
    description:
      "The human language of each passage or phrase in the content can be programmatically determined except for proper names, technical terms, words of indeterminate language, and words or phrases that have become part of the vernacular of the immediately surrounding text.",
    automatable: "partial",
    equivalentTo: ["wcag21:3.1.2"],
  },
  {
    id: "3.1.3",
    title: "Unusual Words",
    level: "AAA",
    slug: "unusual-words",
    description:
      "A mechanism is available for identifying specific definitions of words or phrases used in an unusual or restricted way.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.1.3"],
  },
  {
    id: "3.1.4",
    title: "Abbreviations",
    level: "AAA",
    slug: "abbreviations",
    description:
      "A mechanism for identifying the expanded form or meaning of abbreviations is available.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.1.4"],
  },
  {
    id: "3.1.5",
    title: "Reading Level",
    level: "AAA",
    slug: "reading-level",
    description:
      "When text requires reading ability more advanced than the lower secondary education level, supplemental content or a version that does not require more advanced reading ability is available.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.1.5"],
  },
  {
    id: "3.1.6",
    title: "Pronunciation",
    level: "AAA",
    slug: "pronunciation",
    description:
      "A mechanism is available for identifying specific pronunciation of words where meaning is ambiguous without pronunciation.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.1.6"],
  },

  // 3.2 Predictable
  {
    id: "3.2.1",
    title: "On Focus",
    level: "A",
    slug: "on-focus",
    description:
      "When any user interface component receives focus, it does not initiate a change of context.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.2.1"],
  },
  {
    id: "3.2.2",
    title: "On Input",
    level: "A",
    slug: "on-input",
    description:
      "Changing the setting of any user interface component does not automatically cause a change of context unless the user has been advised of the behavior before using the component.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.2.2"],
  },
  {
    id: "3.2.3",
    title: "Consistent Navigation",
    level: "AA",
    slug: "consistent-navigation",
    description:
      "Navigational mechanisms that are repeated on multiple web pages within a set occur in the same relative order each time they are repeated.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.2.3"],
  },
  {
    id: "3.2.4",
    title: "Consistent Identification",
    level: "AA",
    slug: "consistent-identification",
    description:
      "Components that have the same functionality within a set of web pages are identified consistently.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.2.4"],
  },
  {
    id: "3.2.5",
    title: "Change on Request",
    level: "AAA",
    slug: "change-on-request",
    description:
      "Changes of context are initiated only by user request or a mechanism is available to turn off such changes.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.2.5"],
  },
  {
    id: "3.2.6",
    title: "Consistent Help",
    level: "A",
    slug: "consistent-help",
    description:
      "If a web page contains any of the following help mechanisms, and those mechanisms are repeated on multiple web pages within a set of web pages, they occur in the same order relative to other page content.",
    automatable: "manual",
  },

  // 3.3 Input Assistance
  {
    id: "3.3.1",
    title: "Error Identification",
    level: "A",
    slug: "error-identification",
    description:
      "If an input error is automatically detected, the item that is in error is identified and the error is described to the user in text.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.3.1"],
  },
  {
    id: "3.3.2",
    title: "Labels or Instructions",
    level: "A",
    slug: "labels-or-instructions",
    description: "Labels or instructions are provided when content requires user input.",
    automatable: "full",
    equivalentTo: ["wcag21:3.3.2"],
  },
  {
    id: "3.3.3",
    title: "Error Suggestion",
    level: "AA",
    slug: "error-suggestion",
    description:
      "If an input error is automatically detected and suggestions for correction are known, the suggestions are provided to the user.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.3.3"],
  },
  {
    id: "3.3.4",
    title: "Error Prevention (Legal, Financial, Data)",
    level: "AA",
    slug: "error-prevention-legal-financial-data",
    description:
      "For web pages that cause legal commitments or financial transactions, submissions are reversible, checked, or confirmed.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.3.4"],
  },
  {
    id: "3.3.5",
    title: "Help",
    level: "AAA",
    slug: "help",
    description: "Context-sensitive help is available.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.3.5"],
  },
  {
    id: "3.3.6",
    title: "Error Prevention (All)",
    level: "AAA",
    slug: "error-prevention-all",
    description:
      "For web pages that require the user to submit information, submissions are reversible, checked, or confirmed.",
    automatable: "manual",
    equivalentTo: ["wcag21:3.3.6"],
  },
  {
    id: "3.3.7",
    title: "Redundant Entry",
    level: "A",
    slug: "redundant-entry",
    description:
      "Information previously entered by or provided to the user that is required to be entered again in the same process is auto-populated or available for the user to select.",
    automatable: "manual",
  },
  {
    id: "3.3.8",
    title: "Accessible Authentication (Minimum)",
    level: "AA",
    slug: "accessible-authentication-minimum",
    description:
      "A cognitive function test is not required for any step in an authentication process unless an alternative is provided or the test is object recognition or personal content.",
    automatable: "manual",
  },
  {
    id: "3.3.9",
    title: "Accessible Authentication (Enhanced)",
    level: "AAA",
    slug: "accessible-authentication-enhanced",
    description:
      "A cognitive function test is not required for any step in an authentication process unless an alternative is provided or the test is object recognition.",
    automatable: "manual",
  },

  // =========================================================================
  // Principle 4 — Robust
  // =========================================================================

  // 4.1 Compatible
  // Note: 4.1.1 Parsing was removed in WCAG 2.2 (always satisfies). We keep
  // the ID for historical reference but mark it manual since it's a no-op
  // for new WCAG 2.2 conformance claims. Rules targeting malformed-markup
  // catch this kind of issue should satisfy 4.1.2 instead.
  {
    id: "4.1.1",
    title: "Parsing (Obsolete in WCAG 2.2)",
    level: "A",
    slug: "parsing",
    description:
      "In content implemented using markup languages, elements have complete start and end tags, are nested according to specifications, do not contain duplicate attributes, and IDs are unique. NOTE: This criterion is obsolete in WCAG 2.2 and always satisfies — modern parsers recover from these errors.",
    automatable: "manual",
    equivalentTo: ["wcag21:4.1.1"],
  },
  {
    id: "4.1.2",
    title: "Name, Role, Value",
    level: "A",
    slug: "name-role-value",
    description:
      "For all user interface components, the name and role can be programmatically determined; states, properties, and values that can be set by the user can be programmatically set.",
    automatable: "partial",
    equivalentTo: ["wcag21:4.1.2"],
  },
  {
    id: "4.1.3",
    title: "Status Messages",
    level: "AA",
    slug: "status-messages",
    description:
      "Status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus.",
    automatable: "partial",
    equivalentTo: ["wcag21:4.1.3"],
  },
];

/**
 * All 87 WCAG 2.2 success criteria as `Criterion` records, ready to register
 * into the standards/criteria registries.
 */
export const WCAG22_CRITERIA: readonly Criterion[] = WCAG22_ROWS.map((row) => ({
  id: `wcag22:${row.id}`,
  standardId: "wcag22",
  localId: row.id,
  title: row.title,
  level: row.level,
  description: row.description,
  url: wcag22Url(row.slug),
  automatable: row.automatable,
  ...(row.equivalentTo !== undefined && { equivalentTo: row.equivalentTo }),
}));
