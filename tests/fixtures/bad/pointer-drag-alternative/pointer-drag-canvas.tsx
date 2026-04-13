// FAILS WCAG 2.2 SC 2.5.7 — onPointerDown + onPointerMove implements a
// custom drag (e.g., panning a map) with no single-pointer alternative.
export function MapPanner() {
  return (
    <div
      onPointerDown={(e) => startPan(e)}
      onPointerMove={(e) => updatePan(e)}
      onPointerUp={(e) => endPan(e)}
    >
      <canvas width={800} height={600} />
    </div>
  );
}

declare function startPan(e: unknown): void;
declare function updatePan(e: unknown): void;
declare function endPan(e: unknown): void;
