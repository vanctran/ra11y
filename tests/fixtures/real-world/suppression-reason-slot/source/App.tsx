// Fixture: demo-mode page with a JSX-comment suppression pragma carrying
// a colon-separated reason suffix. The <img> below would trigger the
// media alt-text rule if the pragma were absent, so the pragma both
// parses AND does real work on a real finding.

export function App() {
  return (
    <main className="demo-page">
      {/* ra11y-disable-next-line media/alt-text-missing: demo page, intentionally missing alt */}
      <img src="chart.png" />
    </main>
  );
}

export default App;
