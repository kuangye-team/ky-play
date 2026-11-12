import { isDesktop } from "./runtime";

type WindowTheme = {
  scheme: "light" | "dark";
  color: string;
  textColor: string;
};

let pending = Promise.resolve();

/** Keep native window updates in order when themes are switched quickly. */
export function syncDesktopTheme({ scheme, color, textColor }: WindowTheme) {
  if (!isDesktop) return;
  pending = pending.then(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.setTheme(scheme);
    await window.setBackgroundColor(color);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_title_bar_color", { color, textColor });
  }).catch((error) => console.error("Could not update the window theme", error));
  return pending;
}
