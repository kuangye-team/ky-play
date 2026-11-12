import { cdnServer, previewServer, previewURL, suiteConfig } from "./shared";

export default suiteConfig("pwa", {
  use: { baseURL: previewURL, serviceWorkers: "allow" },
  webServer: [cdnServer, previewServer],
});
