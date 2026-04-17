import { Button } from "./Button";
import { Link } from "./Link";

/**
 * Consumer file. Uses Button and Link enough times that
 * opaqueCustomComponentsTop won't flag them after auto-detection.
 * Each usage carries onClick so the auto-detector registers them.
 */
export function App() {
  return (
    <main>
      <Button onClick={() => undefined}>Save</Button>
      <Button onClick={() => undefined}>Cancel</Button>
      <Button onClick={() => undefined}>Submit</Button>
      <Link href="/about" onClick={() => undefined}>About</Link>
      <Link href="/help" onClick={() => undefined}>Help</Link>
      <Link href="/home" onClick={() => undefined}>Home</Link>
    </main>
  );
}
