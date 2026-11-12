import { ssgRoot, suiteConfig } from "./shared";

const baseURL = "http://localhost:1421";

export default suiteConfig("desktop", {
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL, viewport: { width: 1280, height: 820 }, serviceWorkers: "allow" },
  webServer: {
    command: "npm run dev -- --mode desktop --host localhost --port 1421",
    cwd: ssgRoot,
    env: { VITE_DESKTOP_UPDATER_ENABLED: "true" },
    url: baseURL,
    reuseExistingServer: false,
  },
});
