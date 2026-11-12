import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { transformWithEsbuild, type Plugin } from "vite";
import { inlineAssetPaths } from "./app-assets";
import { minifyHtml } from "./minify-html";

export function emulatorAssets(root: string, cdn: string, { deploy = false, desktop = false } = {}) {
  const release = JSON.parse(readFileSync(resolve(root, "licenses/emulatorjs.json"), "utf8"));
  const cores = JSON.parse(readFileSync(resolve(root, "licenses/cores.json"), "utf8"));
  const manifest = {
    version: release.version,
    runtimeVersion: release.version,
    coreVersions: Object.fromEntries(cores.map((core: { id: string; version: string }) => [core.id, core.version])),
    files: [],
  };
  const bundle = !deploy && !cdn.trim();
  let baseUrl = "/emulatorjs/data/";
  if (!bundle) {
    const url = new URL(cdn.trim() || release.cdnUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.replace(/\/$/, "").endsWith(`/${manifest.version}`))
      throw new Error(`VITE_EMULATOR_CDN_URL must point to a ${manifest.version} release directory, such as ${release.cdnUrl}`);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error("Public emulator CDN URLs must use HTTPS.");
    baseUrl = `${url.href.replace(/\/$/, "")}/data/`;
  }
  let outDir = "";
  const plugin: Plugin = {
    name: "emulator-assets",
    apply: "build",
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    async writeBundle() {
      // Desktop bundles the release as shared application resources instead
      // of embedding a copy in each architecture's executable.
      await mkdir(outDir, { recursive: true });
      const publicDir = resolve(root, "public");
      for (const name of await readdir(resolve(root, "public"))) {
        // Installation icons are all embedded as Data URLs; omit the directory too.
        if (name === "icons") continue;
        if (name === "emulator" || (name === "emulatorjs" && (!bundle || desktop))) continue;
        if (/^player.*\.(?:html|js)$/.test(name)) continue;
        await cp(resolve(publicDir, name), resolve(outDir, name), {
          recursive: true,
          filter: (source) => !basename(source).startsWith(".") &&
            !inlineAssetPaths.has(`/${relative(publicDir, source).split("\\").join("/")}`),
        });
      }
      // Preserve classic script ordering and globals inside the isolated player.
      // Inline them into its HTML so the SW caches one complete player document.
      const player = readFileSync(resolve(publicDir, "player.html"), "utf8");
      const scripts = [...player.matchAll(/<script src="\/(player[^"/]*\.js)"><\/script>/g)];
      let playerHtml = player;
      for (const [tag, file] of scripts) {
        const { code } = await transformWithEsbuild(readFileSync(resolve(publicDir, file), "utf8"), file, {
          minify: true, target: "es2022",
        });
        playerHtml = playerHtml.replace(tag, () => `<script>${code.replace(/<\/script/gi, "<\\/script")}</script>`);
      }
      await writeFile(resolve(outDir, "player.html"), await minifyHtml(playerHtml));
      await writeFile(resolve(outDir, "emulator-release.json"), JSON.stringify({ baseUrl, ...manifest }, null, 2) + "\n");
    },
  };
  return { baseUrl, plugin };
}
