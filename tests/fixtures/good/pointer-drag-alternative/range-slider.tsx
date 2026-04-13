// WCAG 2.2 SC 2.5.7 exception — input[type=range] is user-agent
// determined; the browser provides keyboard operation natively.
export function VolumeSlider() {
  return <input type="range" min={0} max={100} defaultValue={50} aria-label="Volume" />;
}
