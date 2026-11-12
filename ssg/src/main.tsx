import { initializePreferences } from "./lib/preferences";
import { initializeInstallManifest } from "./lib/app-assets";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router";
import App from "./App";
import { startAppUpdates } from "./lib/app-updates";
import {
  isDesktop,
  startDesktopDevtools,
  startDesktopLinks,
} from "./lib/desktop";
import "./styles.css";
import "./themes.css";
import "./appearance.css";
async function start() {
  initializeInstallManifest();
  await initializePreferences().catch(console.error);
  startAppUpdates();
  startDesktopLinks();
  startDesktopDevtools();
  const Router = isDesktop ? HashRouter : BrowserRouter;
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Router>
        <App />
      </Router>
    </React.StrictMode>,
  );
}
void start();
