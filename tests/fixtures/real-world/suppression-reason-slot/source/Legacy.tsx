// Fixture: legacy widget with a line-comment suppression pragma carrying
// a colon-separated reason suffix. The click handler below would trigger
// the keyboard-handler rule if the pragma were absent.

// ra11y-disable-next-line keyboard/handler-missing: legacy widget, scheduled for replacement
export function LegacyWidget() {
  return (
    <div onClick={() => void 0}><span>Activate</span></div>
  );
}

export default LegacyWidget;
