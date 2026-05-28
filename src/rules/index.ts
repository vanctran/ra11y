/**
 * Built-in rules barrel. Every rule ra11y ships out of the box is
 * registered here, covering the auto/partial criteria under WCAG 2.1
 * A+AA + WCAG 2.2 A+AA additions. See `BUILTIN_RULES` below for the
 * current inventory.
 */

import type { Rule } from "../types/rule.ts";
import { rule as conflictingRole } from "./aria/conflicting-role.ts";
import { rule as dialogRoleMissing } from "./aria/dialog-role-missing.ts";
import { rule as disabledLinkSurrogate } from "./aria/disabled-link-surrogate.ts";
import { rule as dropdownToggleTripleAriaMissing } from "./aria/dropdown-toggle-triple-aria-missing.ts";
import { rule as expandedOnDisclosure } from "./aria/expanded-on-disclosure.ts";
import { rule as hiddenFocus } from "./aria/hidden-focus.ts";
import { rule as iconChildMissingAriaHidden } from "./aria/icon-child-missing-aria-hidden.ts";
import { rule as iconFontHidden } from "./aria/icon-font-hidden.ts";
import { rule as invalidRole } from "./aria/invalid-role.ts";
import { rule as labelledbyTargetExists } from "./aria/labelledby-target-exists.ts";
import { rule as liveRegionMissingOnInnerhtmlTarget } from "./aria/live-region-missing-on-innerhtml-target.ts";
import { rule as liveRegionValid } from "./aria/live-region-valid.ts";
import { rule as nestedLiveRegion } from "./aria/nested-live-region.ts";
import { rule as popoverTriggerMissingHaspopup } from "./aria/popover-trigger-missing-haspopup.ts";
import { rule as presentationOnSemanticAncestor } from "./aria/presentation-on-semantic-ancestor.ts";
import { rule as progressbarValueRange } from "./aria/progressbar-value-range.ts";
import { rule as redundantRoleOnHostElement } from "./aria/redundant-role-on-host-element.ts";
import { rule as requiredAttrs } from "./aria/required-attrs.ts";
import { rule as roleFromClassOnly } from "./aria/role-from-class-only.ts";
import { rule as tabControlsMissing } from "./aria/tab-controls-missing.ts";
import { rule as tabWidgetRoles } from "./aria/tab-widget-roles.ts";
import { rule as tablistOnNonTabContainer } from "./aria/tablist-on-non-tab-container.ts";
import { rule as validAttr } from "./aria/valid-attr.ts";
import { rule as meaningByColorOnly } from "./color/meaning-by-color-only.ts";
import { rule as stateClassColorOnly } from "./color/state-class-color-only.ts";
import { rule as contrastEnhanced } from "./contrast/enhanced.ts";
import { rule as contrastMinimum } from "./contrast/minimum.ts";
import { rule as contrastNonText } from "./contrast/non-text.ts";
import { rule as charsetFirst1024Bytes } from "./document/charset-first-1024-bytes.ts";
import { rule as iframeTitle } from "./document/iframe-title.ts";
import { rule as langAttribute } from "./document/lang-attribute.ts";
import { rule as langOnParts } from "./document/lang-on-parts.ts";
import { rule as metaRefresh } from "./document/meta-refresh.ts";
import { rule as pageTitled } from "./document/page-titled.ts";
import { rule as viewportZoom } from "./document/viewport-zoom.ts";
import { rule as notObscured } from "./focus/not-obscured.ts";
import { rule as outlineVisible } from "./focus/outline-visible.ts";
import { rule as tabindexPositive } from "./focus/tabindex-positive.ts";
import { rule as ariaInvalidMissing } from "./forms/aria-invalid-missing.ts";
import { rule as asteriskRequiredMarker } from "./forms/asterisk-required-marker.ts";
import { rule as autocompleteMissing } from "./forms/autocomplete-missing.ts";
import { rule as errorMessageNotAssociated } from "./forms/error-message-not-associated.ts";
import { rule as fieldsetLegend } from "./forms/fieldset-legend.ts";
import { rule as labelAdjacentMismatch } from "./forms/label-adjacent-mismatch.ts";
import { rule as labelAdjacentUnassociated } from "./forms/label-adjacent-unassociated.ts";
import { rule as labelForIdMismatch } from "./forms/label-for-id-mismatch.ts";
import { rule as labelsRequired } from "./forms/labels-required.ts";
import { rule as multipleLabelForSameId } from "./forms/multiple-label-for-same-id.ts";
import { rule as noSubmitControl } from "./forms/no-submit-control.ts";
import { rule as nonEmptyLabel } from "./forms/non-empty-label.ts";
import { rule as placeholderAsLabel } from "./forms/placeholder-as-label.ts";
import { rule as radioGroupWithoutFieldset } from "./forms/radio-group-without-fieldset.ts";
import { rule as requiredIndicatorMissing } from "./forms/required-indicator-missing.ts";
import { rule as requiredMarkerWithoutRequiredAttr } from "./forms/required-marker-without-required-attr.ts";
import { rule as selectOnchangeContextChange } from "./forms/select-onchange-context-change.ts";
import { rule as submitNotButtonOrInput } from "./forms/submit-not-button-or-input.ts";
import { rule as valueAsLabel } from "./forms/value-as-label.ts";
import { rule as accesskeyDuplicate } from "./keyboard/accesskey-duplicate.ts";
import { rule as anchorButtonNotFocusable } from "./keyboard/anchor-button-not-focusable.ts";
import { rule as characterShortcuts } from "./keyboard/character-shortcuts.ts";
import { rule as handlerMissing } from "./keyboard/handler-missing.ts";
import { rule as hoverOnlyNoFocusMirror } from "./keyboard/hover-only-no-focus-mirror.ts";
import { rule as interactiveDivRoleMissing } from "./keyboard/interactive-div-role-missing.ts";
import { rule as horizontalScrollNoKeyboard } from "./layout/horizontal-scroll-no-keyboard.ts";
import { rule as orientationLock } from "./layout/orientation-lock.ts";
import { rule as reflowHardcodedWidth } from "./layout/reflow-hardcoded-width.ts";
import { rule as textSpacing } from "./layout/text-spacing.ts";
import { rule as altTextMissing } from "./media/alt-text-missing.ts";
import { rule as altTextPlaceholder } from "./media/alt-text-placeholder.ts";
import { rule as audioControlsOrTranscriptMissing } from "./media/audio-controls-or-transcript-missing.ts";
import { rule as audioVideoNoControls } from "./media/audio-video-no-controls.ts";
import { rule as autoplaySound } from "./media/autoplay-sound.ts";
import { rule as imgEmptyAltInClickableGroup } from "./media/img-empty-alt-in-clickable-group.ts";
import { rule as svgAccessibleName } from "./media/svg-accessible-name.ts";
import { rule as videoCaptionsMissing } from "./media/video-captions-missing.ts";
import { rule as animationFromInteractions } from "./motion/animation-from-interactions.ts";
import { rule as pauseStopHide } from "./motion/pause-stop-hide.ts";
import { rule as hrefEmptyFragment } from "./navigation/href-empty-fragment.ts";
import { rule as hrefJavascriptScheme } from "./navigation/href-javascript-scheme.ts";
import { rule as inPageLinkFragmentMissing } from "./navigation/in-page-link-fragment-missing.ts";
import { rule as linkDescriptiveText } from "./navigation/link-descriptive-text.ts";
import { rule as linkNameOnlySymbol } from "./navigation/link-name-only-symbol.ts";
import { rule as linkNoHref } from "./navigation/link-no-href.ts";
import { rule as linkTargetBlankAnnouncement } from "./navigation/link-target-blank-announcement.ts";
import { rule as skipLink } from "./navigation/skip-link.ts";
import { rule as duplicateId } from "./parsing/duplicate-id.ts";
import { rule as htmlHasLang } from "./parsing/html-has-lang.ts";
import { rule as invalidIdShape } from "./parsing/invalid-id-shape.ts";
import { rule as malformedTag } from "./parsing/malformed-tag.ts";
import { rule as cancellation } from "./pointer/cancellation.ts";
import { rule as dragAlternative } from "./pointer/drag-alternative.ts";
import { rule as draggableNoKeyboardAlt } from "./pointer/draggable-no-keyboard-alt.ts";
import { rule as stretchedLinkMultipleInContainer } from "./pointer/stretched-link-multiple-in-container.ts";
import { rule as targetSize } from "./pointer/target-size.ts";
import { rule as targetSizeEnhanced } from "./pointer/target-size-enhanced.ts";
import { rule as buttonName } from "./semantics/button-name.ts";
import { rule as buttonNameOnlySymbol } from "./semantics/button-name-only-symbol.ts";
import { rule as duplicateLandmarkUnlabeled } from "./semantics/duplicate-landmark-unlabeled.ts";
import { rule as emptyHeading } from "./semantics/empty-heading.ts";
import { rule as formLandmarkNameMissing } from "./semantics/form-landmark-name-missing.ts";
import { rule as headingClassOnNonheading } from "./semantics/heading-class-on-nonheading.ts";
import { rule as headingHierarchy } from "./semantics/heading-hierarchy.ts";
import { rule as inlineDisplayNoneOnFocusable } from "./semantics/inline-display-none-on-focusable.ts";
import { rule as interactiveAncestorOfHeading } from "./semantics/interactive-ancestor-of-heading.ts";
import { rule as labelInName } from "./semantics/label-in-name.ts";
import { rule as landmarkMain } from "./semantics/landmark-main.ts";
import { rule as layoutTableNoPresentationRole } from "./semantics/layout-table-no-presentation-role.ts";
import { rule as listStructure } from "./semantics/list-structure.ts";
import { rule as nestedInteractive } from "./semantics/nested-interactive.ts";
import { rule as sectionAccessibleNameMissing } from "./semantics/section-accessible-name-missing.ts";
import { rule as svgTitleMissing } from "./semantics/svg-title-missing.ts";
import { rule as tableCaptionMissing } from "./semantics/table-caption-missing.ts";
import { rule as tableHeaders } from "./semantics/table-headers.ts";
import { rule as tableThScopeMissing } from "./semantics/table-th-scope-missing.ts";
import { rule as visualDisabledNonControl } from "./semantics/visual-disabled-non-control.ts";
import { rule as tooltipDismissable } from "./tooltip/dismissable.ts";
import { rule as wrapperDrift } from "./wrapper/drift.ts";

export const BUILTIN_RULES: readonly Rule[] = [
  accesskeyDuplicate,
  altTextMissing,
  altTextPlaceholder,
  anchorButtonNotFocusable,
  animationFromInteractions,
  ariaInvalidMissing,
  asteriskRequiredMarker,
  audioControlsOrTranscriptMissing,
  audioVideoNoControls,
  autocompleteMissing,
  autoplaySound,
  buttonName,
  buttonNameOnlySymbol,
  cancellation,
  characterShortcuts,
  charsetFirst1024Bytes,
  conflictingRole,
  contrastEnhanced,
  contrastMinimum,
  contrastNonText,
  dialogRoleMissing,
  disabledLinkSurrogate,
  dragAlternative,
  draggableNoKeyboardAlt,
  dropdownToggleTripleAriaMissing,
  duplicateId,
  duplicateLandmarkUnlabeled,
  emptyHeading,
  errorMessageNotAssociated,
  expandedOnDisclosure,
  fieldsetLegend,
  formLandmarkNameMissing,
  handlerMissing,
  headingClassOnNonheading,
  headingHierarchy,
  hiddenFocus,
  horizontalScrollNoKeyboard,
  hoverOnlyNoFocusMirror,
  hrefEmptyFragment,
  hrefJavascriptScheme,
  htmlHasLang,
  iconChildMissingAriaHidden,
  iconFontHidden,
  iframeTitle,
  imgEmptyAltInClickableGroup,
  inPageLinkFragmentMissing,
  inlineDisplayNoneOnFocusable,
  interactiveAncestorOfHeading,
  interactiveDivRoleMissing,
  invalidIdShape,
  invalidRole,
  labelAdjacentMismatch,
  labelAdjacentUnassociated,
  labelForIdMismatch,
  labelInName,
  labelledbyTargetExists,
  labelsRequired,
  landmarkMain,
  langAttribute,
  langOnParts,
  layoutTableNoPresentationRole,
  linkDescriptiveText,
  linkNameOnlySymbol,
  linkNoHref,
  linkTargetBlankAnnouncement,
  listStructure,
  liveRegionMissingOnInnerhtmlTarget,
  liveRegionValid,
  malformedTag,
  meaningByColorOnly,
  metaRefresh,
  multipleLabelForSameId,
  nestedInteractive,
  nestedLiveRegion,
  noSubmitControl,
  nonEmptyLabel,
  notObscured,
  orientationLock,
  outlineVisible,
  pageTitled,
  pauseStopHide,
  placeholderAsLabel,
  popoverTriggerMissingHaspopup,
  presentationOnSemanticAncestor,
  progressbarValueRange,
  radioGroupWithoutFieldset,
  redundantRoleOnHostElement,
  reflowHardcodedWidth,
  requiredAttrs,
  requiredIndicatorMissing,
  requiredMarkerWithoutRequiredAttr,
  roleFromClassOnly,
  sectionAccessibleNameMissing,
  selectOnchangeContextChange,
  skipLink,
  stateClassColorOnly,
  stretchedLinkMultipleInContainer,
  submitNotButtonOrInput,
  svgAccessibleName,
  svgTitleMissing,
  tabControlsMissing,
  tabindexPositive,
  tableCaptionMissing,
  tableHeaders,
  tableThScopeMissing,
  tabWidgetRoles,
  tablistOnNonTabContainer,
  targetSize,
  targetSizeEnhanced,
  textSpacing,
  tooltipDismissable,
  validAttr,
  valueAsLabel,
  videoCaptionsMissing,
  viewportZoom,
  visualDisabledNonControl,
  wrapperDrift,
];

export {
  accesskeyDuplicate,
  altTextMissing,
  altTextPlaceholder,
  anchorButtonNotFocusable,
  animationFromInteractions,
  ariaInvalidMissing,
  asteriskRequiredMarker,
  audioControlsOrTranscriptMissing,
  audioVideoNoControls,
  autocompleteMissing,
  autoplaySound,
  buttonName,
  buttonNameOnlySymbol,
  cancellation,
  characterShortcuts,
  charsetFirst1024Bytes,
  conflictingRole,
  contrastEnhanced,
  contrastMinimum,
  contrastNonText,
  dialogRoleMissing,
  disabledLinkSurrogate,
  dragAlternative,
  draggableNoKeyboardAlt,
  dropdownToggleTripleAriaMissing,
  duplicateId,
  duplicateLandmarkUnlabeled,
  emptyHeading,
  errorMessageNotAssociated,
  expandedOnDisclosure,
  fieldsetLegend,
  formLandmarkNameMissing,
  handlerMissing,
  headingClassOnNonheading,
  headingHierarchy,
  hiddenFocus,
  horizontalScrollNoKeyboard,
  hoverOnlyNoFocusMirror,
  hrefEmptyFragment,
  hrefJavascriptScheme,
  htmlHasLang,
  iconChildMissingAriaHidden,
  iconFontHidden,
  iframeTitle,
  imgEmptyAltInClickableGroup,
  inlineDisplayNoneOnFocusable,
  inPageLinkFragmentMissing,
  interactiveAncestorOfHeading,
  interactiveDivRoleMissing,
  invalidIdShape,
  invalidRole,
  labelAdjacentMismatch,
  labelAdjacentUnassociated,
  labelForIdMismatch,
  labelInName,
  labelledbyTargetExists,
  labelsRequired,
  landmarkMain,
  langAttribute,
  langOnParts,
  layoutTableNoPresentationRole,
  linkDescriptiveText,
  linkNameOnlySymbol,
  linkNoHref,
  linkTargetBlankAnnouncement,
  listStructure,
  liveRegionMissingOnInnerhtmlTarget,
  liveRegionValid,
  malformedTag,
  meaningByColorOnly,
  metaRefresh,
  multipleLabelForSameId,
  nestedInteractive,
  nestedLiveRegion,
  nonEmptyLabel,
  noSubmitControl,
  notObscured,
  orientationLock,
  outlineVisible,
  pageTitled,
  pauseStopHide,
  placeholderAsLabel,
  popoverTriggerMissingHaspopup,
  presentationOnSemanticAncestor,
  progressbarValueRange,
  radioGroupWithoutFieldset,
  redundantRoleOnHostElement,
  reflowHardcodedWidth,
  requiredAttrs,
  requiredIndicatorMissing,
  requiredMarkerWithoutRequiredAttr,
  roleFromClassOnly,
  sectionAccessibleNameMissing,
  selectOnchangeContextChange,
  skipLink,
  stateClassColorOnly,
  stretchedLinkMultipleInContainer,
  submitNotButtonOrInput,
  svgAccessibleName,
  svgTitleMissing,
  tabControlsMissing,
  tabindexPositive,
  tableCaptionMissing,
  tableHeaders,
  tableThScopeMissing,
  tablistOnNonTabContainer,
  tabWidgetRoles,
  targetSize,
  targetSizeEnhanced,
  textSpacing,
  tooltipDismissable,
  validAttr,
  valueAsLabel,
  videoCaptionsMissing,
  viewportZoom,
  visualDisabledNonControl,
  wrapperDrift,
};
