import { installManifest } from "virtual:app-assets";
import { isDesktop } from "./runtime";

export function initializeInstallManifest() {
  if (isDesktop) return;
  // Data URLs have no base path; installation must also work on deep links.
  const rootUrl = new URL("/", location.href).href;
  const manifest = { ...installManifest, id: rootUrl, start_url: rootUrl, scope: rootUrl };
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`;
  document.head.append(link);
}
