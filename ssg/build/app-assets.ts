import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import games from "../licenses/games/bundled.json";

const manifestPath = "/manifest.webmanifest";
const faviconPath = "/favicon.svg";
const appleIconPath = "/icons/apple-touch-icon.png";
const controllerPath = "/assets/controller.webp";
const root = resolve(import.meta.dirname, "../public");
const manifest = JSON.parse(readFileSync(resolve(root, manifestPath.slice(1)), "utf8"));

// These source files are embedded in HTML or JS instead of copied to dist.
export const inlineAssetPaths = new Set([
  manifestPath, faviconPath, appleIconPath, controllerPath,
  ...manifest.icons.map((icon: { src: string }) => icon.src),
  ...games.map((game) => game.cover),
]);

export function appAssets(): Plugin {
  const moduleId = "virtual:app-assets";
  const resolvedId = `\0${moduleId}`;
  const dataUrl = (path: string, mime: string) =>
    `data:${mime};base64,${readFileSync(resolve(root, path.slice(1))).toString("base64")}`;
  return {
    name: "inline-app-assets",
    resolveId(id) {
      if (id === moduleId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      const assets = {
        installManifest: {
          ...manifest,
          icons: manifest.icons.map((icon: { src: string; type: string }) => ({
            ...icon, src: dataUrl(icon.src, icon.type),
          })),
        },
        controllerImage: dataUrl(controllerPath, "image/webp"),
        gameCovers: Object.fromEntries(games.map((game) => [game.id, dataUrl(game.cover, "image/png")])),
      };
      return Object.entries(assets).map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`).join("\n");
    },
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html
        .replace(`href="${faviconPath}"`, () => `href="${dataUrl(faviconPath, "image/svg+xml")}"`)
        .replace(`href="${appleIconPath}"`, () => `href="${dataUrl(appleIconPath, "image/png")}"`),
    },
  };
}
