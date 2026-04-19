/**
 * page.tsx — parent page that conditionally mounts all three dialog variants.
 * Provides a realistic rendering context for the scanner: dialog components
 * are imported and rendered conditionally based on state, which is the
 * real-world pattern that produces the ARIA wiring issues captured here.
 */

import { useState } from "react";
import { VariantA, VariantB, VariantC } from "./ConfirmDialog";

export function ItemPage() {
  const [dialogA, setDialogA] = useState(false);
  const [dialogB, setDialogB] = useState(false);
  const [dialogC, setDialogC] = useState(false);

  return (
    <main>
      <h1>Item management</h1>

      <button type="button" onClick={() => setDialogA(true)}>
        Remove item (unlabeled dialog)
      </button>

      <button type="button" onClick={() => setDialogB(true)}>
        Transfer ownership (labeled, no description)
      </button>

      <button type="button" onClick={() => setDialogC(true)}>
        Delete account (fully labeled)
      </button>

      {/* VariantA: unlabeled dialog — missing aria-labelledby */}
      <VariantA
        isOpen={dialogA}
        onConfirm={() => setDialogA(false)}
        onCancel={() => setDialogA(false)}
      />

      {/* VariantB: labeled dialog — missing aria-describedby */}
      <VariantB
        isOpen={dialogB}
        onConfirm={() => setDialogB(false)}
        onCancel={() => setDialogB(false)}
      />

      {/* VariantC: fully labeled dialog — correct ARIA wiring */}
      <VariantC
        isOpen={dialogC}
        onConfirm={() => setDialogC(false)}
        onCancel={() => setDialogC(false)}
      />
    </main>
  );
}
