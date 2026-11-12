import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import { resolve } from "node:path";

export const ssgRoot = resolve(import.meta.dirname, "../..");
export const cdnURL = "http://127.0.0.1:4174/lib/emulatorjs/4.2.3";
export const previewURL = "http://127.0.0.1:4173";

export function suiteConfig(name: string, config: PlaywrightTestConfig) {
  return defineConfig({
    testDir: resolve(ssgRoot, "tests"),
    testMatch: `${name}/**/*.spec.ts`,
    outputDir: resolve(ssgRoot, "../temp/artifacts/playwright", name),
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
      viewport: { width: 1440, height: 1100 },
      headless: true,
      locale: "zh-CN",
      screenshot: "only-on-failure",
      trace: "retain-on-failure",
      serviceWorkers: "block",
    },
    projects: [{ name }],
  }, config);
}

export const cdnServer = {
  command: "node tests/cdn/server.mjs",
  cwd: ssgRoot,
  url: "http://127.0.0.1:4174/health",
  reuseExistingServer: false,
} satisfies PlaywrightTestConfig["webServer"];

export const previewServer = {
  // Build with the same environment as preview so suites cannot use a stale build.
  command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
  cwd: ssgRoot,
  env: { VITE_EMULATOR_CDN_URL: cdnURL },
  url: previewURL,
  timeout: 120_000,
  reuseExistingServer: false,
} satisfies PlaywrightTestConfig["webServer"];
