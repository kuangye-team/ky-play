import { previewServer, previewURL, suiteConfig } from "./shared";

export default suiteConfig("bundled", {
  expect: { timeout: 5_000 },
  use: { baseURL: process.env.BUNDLED_BASE_URL || previewURL },
  webServer: process.env.BUNDLED_BASE_URL ? undefined : {
    ...previewServer,
    env: { VITE_EMULATOR_CDN_URL: "" },
  },
});
