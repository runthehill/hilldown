import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

// Self-hosted fonts (bundled, offline-safe): Hanken Grotesk for UI chrome,
// Newsreader for the rendered reading surface, IBM Plex Mono for raw source.
import "@fontsource-variable/hanken-grotesk/wght.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/newsreader/latin-700.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/newsreader/latin-600-italic.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
