import { translate } from "./i18n";

import { isDesktop } from "./runtime";
export { isDesktop } from "./runtime";
let exporting = 0;
export const isDesktopExporting = () => exporting > 0;

export function openDesktopDevtools() {
  if (!isDesktop) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("open_devtools"))
    .catch((error) => console.error("Could not open developer tools", error));
}

export function startDesktopDevtools() {
  if (!isDesktop) return;
  window.addEventListener("keydown", (event) => {
    if (event.code !== "F12" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) openDesktopDevtools();
  }, true);
}

/** The native save dialog grants access only to the path the user selects. */
export async function saveDesktopFile(blob: Blob, filename: string) {
  exporting++;
  try {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({ defaultPath: filename });
    if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  } finally {
    exporting--;
  }
}

export function startDesktopLinks() {
  if (!isDesktop) return;
  document.addEventListener("click", (event) => {
    const link = (event.target as Element)?.closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    const url = new URL(link.href);
    if (!["http:", "https:", "mailto:"].includes(url.protocol) || url.origin === location.origin) return;
    event.preventDefault();
    void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url.href)).catch(async () => {
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(translate("链接暂时无法打开，请稍后重试。"), { kind: "error" });
    });
  });
}
