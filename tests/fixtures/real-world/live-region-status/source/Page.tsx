/**
 * Page — mounts the valid and broken live region variants side by side.
 *
 * The valid components (StatusBanner, ToastRegion) should produce zero
 * aria/live-region-valid violations. The broken variants
 * (BrokenStatusBanner, BrokenToastRegion, HiddenLiveRegion) carry
 * deliberate structural faults the rule must detect statically.
 */

import { BrokenStatusBanner, StatusBanner } from "./StatusBanner.tsx";
import { BrokenToastRegion, HiddenLiveRegion, ToastRegion } from "./ToastRegion.tsx";

export function Page() {
  return (
    <main>
      <h1>Widget Dashboard</h1>

      {/* Correct patterns — no violations expected */}
      <StatusBanner message="Data loaded successfully." />
      <ToastRegion text={null} />

      {/* Broken patterns — violations expected */}
      <BrokenStatusBanner />
      <BrokenToastRegion />
      <HiddenLiveRegion />
    </main>
  );
}
