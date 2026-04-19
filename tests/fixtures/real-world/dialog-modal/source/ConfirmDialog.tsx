/**
 * ConfirmDialog — sanitized modal component exercising the full
 * dialog ARIA labeling surface:
 *
 *   VariantA — role="dialog" with NO aria-labelledby and NO aria-label.
 *     Visible heading present but not programmatically associated.
 *     The backdrop div has onClick with no keyboard handler.
 *     The close button is icon-only with no accessible name.
 *
 *   VariantB — role="dialog" with aria-labelledby pointing at a heading
 *     but NO aria-describedby. The dialog is named but not described.
 *
 *   VariantC — role="dialog" with both aria-labelledby AND aria-describedby.
 *     Fully annotated — the correctly-labeled variant.
 */

import { useState } from "react";

interface DialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// VariantA — unlabeled dialog, icon-only close button, backdrop click trap
// ---------------------------------------------------------------------------

export function VariantA({ isOpen, onConfirm, onCancel }: DialogProps) {
  const [open, setOpen] = useState(isOpen);
  if (!open) return null;
  const handleCancel = () => { onCancel(); setOpen(false); };
  return (
    <div className="backdrop" onClick={handleCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="dialog-panel"
      >
        <div className="dialog-header">
          <h2 id="dialog-a-heading">Remove item</h2>
          <button type="button" onClick={handleCancel}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p>Are you sure you want to remove this item? This action cannot be undone.</p>
        <div className="dialog-actions">
          <button type="button" onClick={handleCancel}>Cancel</button>
          <button type="button" onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VariantB — labeled dialog (aria-labelledby) but no aria-describedby
// ---------------------------------------------------------------------------

export function VariantB({ isOpen, onConfirm, onCancel }: DialogProps) {
  if (!isOpen) return null;
  return (
    <div className="backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-b-heading"
        className="dialog-panel"
      >
        <div className="dialog-header">
          <h2 id="dialog-b-heading">Transfer ownership</h2>
          <button type="button" aria-label="Close dialog" onClick={onCancel}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p id="dialog-b-desc">
          Transferring ownership will remove your admin access. You will not
          be able to undo this from the settings panel.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onConfirm}>Transfer</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VariantC — fully labeled dialog (aria-labelledby + aria-describedby)
// ---------------------------------------------------------------------------

export function VariantC({ isOpen, onConfirm, onCancel }: DialogProps) {
  if (!isOpen) return null;
  return (
    <div className="backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-c-heading"
        aria-describedby="dialog-c-desc"
        className="dialog-panel"
      >
        <div className="dialog-header">
          <h2 id="dialog-c-heading">Delete account</h2>
          <button type="button" aria-label="Close dialog" onClick={onCancel}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p id="dialog-c-desc">
          Deleting your account is permanent. All data will be removed and
          cannot be recovered.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onConfirm}>Delete account</button>
        </div>
      </div>
    </div>
  );
}
