import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const desktopDist = resolve(root, "app/dist");
const config = JSON.parse(readFileSync(resolve(root, "app/tauri.conf.json"), "utf8"));
export const productName = config.productName;
export function desktopBundleResources(env) {
  // Use an array to replace the default resource map during Tauri config merge.
  return env.VITE_EMULATOR_CDN_URL?.trim() ? [] : config.bundle.resources;
}
export function desktopEnv() {
  const path = resolve(root, "app/.env");
  return { ...parseEnv(readFileSync(resolve(root, "app/.env.example"), "utf8")),
    ...(existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}), ...process.env };
}
export function releaseVersion(value) {
  const version = value.replace(/^v/, "");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Release version must be a stable version such as 1.0.0 or v1.0.0");
  return version;
}
export function httpUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTP or HTTPS URL`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error(`${name} must be an HTTP or HTTPS URL without credentials or a fragment`);
  return url.href;
}
export function updaterConfig(env, release) {
  const endpoint = env.TAURI_UPDATER_URL?.trim();
  const pubkey = env.TAURI_UPDATER_PUBLIC_KEY?.trim();
  if (release && (!endpoint || !pubkey || !env.TAURI_SIGNING_PRIVATE_KEY))
    throw new Error("Release builds require TAURI_UPDATER_URL, TAURI_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY");
  if (endpoint) httpUrl(endpoint, "TAURI_UPDATER_URL");
  return {
    bundle: { createUpdaterArtifacts: release },
    plugins: { updater: {
      endpoints: endpoint && pubkey ? [endpoint] : [],
      pubkey: pubkey || "",
      dangerousInsecureTransportProtocol: Boolean(endpoint && new URL(endpoint).protocol === "http:"),
    } },
  };
}
export function signPathEnabled(env) {
  const enabled = env.SIGNPATH_ENABLED || "false";
  if (!["true", "false"].includes(enabled))
    throw new Error("SIGNPATH_ENABLED must be true or false");
  if (enabled === "false") return false;
  const missing = ["SIGNPATH_API_TOKEN", "SIGNPATH_ORGANIZATION_ID", "SIGNPATH_PROJECT_SLUG", "SIGNPATH_SIGNING_POLICY_SLUG"]
    .filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`SignPath is enabled but configuration is missing: ${missing.join(", ")}`);
  return true;
}
