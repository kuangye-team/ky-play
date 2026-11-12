import { cdnServer, cdnURL, ssgRoot, suiteConfig } from "./shared";

const baseURL = "http://127.0.0.1:5173";

export default suiteConfig("browser", {
  use: { baseURL },
  webServer: [
    cdnServer,
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
      cwd: ssgRoot,
      env: { VITE_EMULATOR_CDN_URL: cdnURL },
      url: baseURL,
      reuseExistingServer: false,
    },
  ],
});
