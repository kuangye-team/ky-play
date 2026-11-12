import { previewServer, previewURL, suiteConfig } from "./shared";

export default suiteConfig("loading", {
  testMatch: "browser/loading.spec.ts",
  use: { baseURL: previewURL },
  webServer: previewServer,
});
