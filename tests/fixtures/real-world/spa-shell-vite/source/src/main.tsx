import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
