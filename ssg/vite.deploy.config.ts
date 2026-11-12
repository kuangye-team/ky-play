import { defineConfig } from "vite";
import { createSsgConfig } from "./vite.config";

// Deployment uses Wrangler vars and serves emulator resources from a CDN.
export default defineConfig(({ mode }) => createSsgConfig(mode, true));
