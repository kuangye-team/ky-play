import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { emulatorAssets } from "../../build/emulator-assets";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("emulator resources in Vite output", () => {
  it.each([
    { name: "regular build bundles the release", deploy: false, desktop: false, cdn: "", baseUrl: "/emulatorjs/data/", bundled: true },
    { name: "deploy omits the release and defaults to the official CDN", deploy: true, desktop: false, cdn: "", baseUrl: "https://cdn.emulatorjs.org/4.2.3/data/", bundled: false },
    { name: "custom CDN overrides local resources", deploy: false, desktop: false, cdn: "https://example.com/lib/4.2.3/", baseUrl: "https://example.com/lib/4.2.3/data/", bundled: false },
    { name: "custom CDN overrides deploy's default", deploy: true, desktop: false, cdn: "https://example.com/lib/4.2.3", baseUrl: "https://example.com/lib/4.2.3/data/", bundled: false },
    { name: "desktop keeps local URLs without embedding emulator files", deploy: false, desktop: true, cdn: "", baseUrl: "/emulatorjs/data/", bundled: false },
    { name: "desktop supports an explicit CDN", deploy: false, desktop: true, cdn: "https://example.com/lib/4.2.3", baseUrl: "https://example.com/lib/4.2.3/data/", bundled: false },
  ])("$name", async ({ deploy, desktop, cdn, baseUrl, bundled }) => {
    const artifacts = resolve(import.meta.dirname, "../../../temp/artifacts");
    await mkdir(artifacts, { recursive: true });
    const root = await mkdtemp(resolve(artifacts, "emulator-build-"));
    temporary.push(root);
    await mkdir(resolve(root, "licenses"));
    for (const file of ["emulatorjs.json", "cores.json"])
      await copyFile(resolve(import.meta.dirname, "../../licenses", file), resolve(root, "licenses", file));
    await mkdir(resolve(root, "public/emulatorjs/data"), { recursive: true });
    await writeFile(resolve(root, "public/emulatorjs/data/loader.js"), "fixture");
    await writeFile(resolve(root, "public/player.html"), '<script src="/player.js"></script>');
    await writeFile(resolve(root, "public/player.js"), 'window.playerReady = true;');
    await writeFile(resolve(root, "public/favicon.svg"), "inlined icon");
    await writeFile(resolve(root, "public/.DS_Store"), "local metadata");
    await writeFile(resolve(root, "index.html"), "<title>fixture</title>");
    // A desktop rebuild must also remove resources embedded by an earlier build.
    await mkdir(resolve(root, "dist/emulatorjs"), { recursive: true });
    await writeFile(resolve(root, "dist/emulatorjs/stale.txt"), "old build");
    const emulator = emulatorAssets(root, cdn, { deploy, desktop });
    expect(emulator.baseUrl).toBe(baseUrl);
    await build({ root, configFile: false, logLevel: "silent", plugins: [emulator.plugin], build: { copyPublicDir: false } });
    expect(existsSync(resolve(root, "dist/emulatorjs"))).toBe(bundled);
    expect(await readFile(resolve(root, "dist/player.html"), "utf8")).toContain("window.playerReady=");
    for (const file of ["player.js", "favicon.svg", ".DS_Store"])
      expect(existsSync(resolve(root, "dist", file))).toBe(false);
    expect(JSON.parse(await readFile(resolve(root, "dist/emulator-release.json"), "utf8")).baseUrl).toBe(baseUrl);
  });
});
