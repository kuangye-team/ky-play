import { cdnServer, previewServer, previewURL, suiteConfig } from "./shared";

export default suiteConfig("cdn", {
  use: { baseURL: previewURL },
  webServer: [cdnServer, previewServer],
});
