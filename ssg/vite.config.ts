import { defineConfig, loadEnv } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { bootLoading } from "./build/boot-loading";
import { emulatorAssets } from "./build/emulator-assets";
import { appAssets } from "./build/app-assets";
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
export default defineConfig(({ mode }) => {
  const desktop = mode === "desktop";
  const deploy = mode === "deploy";
  const env = loadEnv(deploy ? "production" : mode, import.meta.dirname, "");
  const emulator = emulatorAssets(import.meta.dirname, env.VITE_EMULATOR_CDN_URL || "", { deploy, desktop });
  const licenseRevision = createHash("sha256")
    .update(readFileSync(new URL("./public/licenses/index.json", import.meta.url)))
    .digest("hex").slice(0, 16);
  return {
    cacheDir: fileURLToPath(new URL(`../temp/cache/vite/${mode}`, import.meta.url)),
    // Cached dependencies live outside node_modules and must skip React transforms.
    plugins: [react({ exclude: [/\/node_modules\//, /\/temp\/cache\//] }), appAssets(), bootLoading(), emulator.plugin, VitePWA({
      disable: desktop,
      registerType: "prompt",
      injectRegister: "auto",
      // The app supplies the installation manifest with Data URL icons.
      manifest: false,
      workbox: {
        globPatterns: [
          "index.html", "assets/*.{js,css}", "player.html",
        ],
        inlineWorkboxRuntime: true,
        // Only SPA routes may fall back to the app, never downloads or player files.
        navigateFallbackAllowlist: [
          /^\/(?:\?.*)?$/,
          /^\/(?:library|recent|favorites|saves|tags|controls|storage|about|privacy)(?:\/?(?:\?.*)?)$/,
          /^\/play\/[^/?]+(?:\?.*)?$/,
        ],
        // The combined license document is saved only when opened. Online requests
        // refresh it; offline requests can reuse the previously opened document.
        // ROMs remain in IndexedDB; emulator cores keep their own loading path.
        runtimeCaching: [{
          urlPattern: ({ url, sameOrigin }) =>
            sameOrigin && url.pathname === "/licenses/index.json",
          handler: "NetworkFirst",
          options: {
            cacheName: "license-documents",
            networkTimeoutSeconds: 3,
            cacheableResponse: { statuses: [200] },
            expiration: {
              maxEntries: 100,
              maxAgeSeconds: 30 * 24 * 60 * 60,
              purgeOnQuotaError: true,
            },
          },
        }],
        cleanupOutdatedCaches: true,
      },
    })],
    define: {
      "import.meta.env.VITE_DESKTOP": JSON.stringify(desktop),
      "import.meta.env.VITE_EMULATOR_BASE_URL": JSON.stringify(emulator.baseUrl),
      "import.meta.env.VITE_LICENSE_INDEX_URL": JSON.stringify(`/licenses/index.json?v=${licenseRevision}`),
    },
    preview: { headers },
    server: {
      headers,
      host: "0.0.0.0",
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
    },
    build: {
      outDir: desktop ? "desktop-dist" : "dist",
      copyPublicDir: false,
      cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  };
});
