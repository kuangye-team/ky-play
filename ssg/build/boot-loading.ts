import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export function bootLoading(): Plugin {
  return {
    name: "boot-loading",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // Reuse the app's palette and icon without waiting for external assets.
        const themes =
          readFileSync(new URL("../src/themes.css", import.meta.url), "utf8")
            .match(/:root\[data-theme="[^"]+"\]\s*\{[^}]+\}/g)
            ?.join("\n") || "";
        const icon = readFileSync(
          new URL("../public/favicon.svg", import.meta.url),
          "utf8",
        ).replace(/ color="[^"]*"/, "");
        return html
          .replace("/* __BOOT_THEMES__ */", () => themes)
          .replace("<!-- __BOOT_ICON__ -->", () => icon)
          // Production CSS must not block the first paint of the inline loader.
          // The loader waits for both the styles and the application to be ready.
          .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g, (tag) =>
            tag.replace(
              "<link",
              '<link media="print" data-app-style onload="this.media=\'all\'" onerror="this.dataset.failed=\'true\'"',
            ),
          );
      },
    },
  };
}
