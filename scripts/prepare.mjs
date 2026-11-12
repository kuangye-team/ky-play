import { prepareEmulatorJS } from "./prepare-emulatorjs.mjs";

// Cloudflare serves the emulator from a CDN and does not upload these files.
if (!process.argv.includes("--deploy")) await prepareEmulatorJS();
await import("./prepare-licenses.mjs");
