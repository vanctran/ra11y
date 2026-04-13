export function App() {
  document.addEventListener("keydown", function (e) {
    // F100: keyCode 83 = "S" — printable, no modifier, no focus check.
    if (e.keyCode === 83) save();
  });
  return <div />;
}

declare function save(): void;
