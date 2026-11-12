import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { appAssets } from "./build/app-assets";
export default defineConfig({
  plugins: [appAssets()],
  cacheDir: fileURLToPath(new URL("../temp/cache/vitest", import.meta.url)),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
