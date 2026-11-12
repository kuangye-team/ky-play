import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { waitForPicture } from "../browser/helpers";

test("本地模拟器无需外部资源即可启动 NES 并保存进度", async ({ page, request, baseURL }) => {
  const root = resolve(import.meta.dirname, "../..");
  const release = await (await request.get("/emulator-release.json")).json();
  expect(release.baseUrl).toBe("/emulatorjs/data/");
  for (const [path, type] of [
    ["emulator.min.js", /javascript/], ["emulator.min.css", /text\/css/],
    ["localization/zh-CN.json", /application\/json/],
    // Vite preview leaves unknown extensions without a MIME type.
    ["cores/fceumm-thread-wasm.data", /^(?:application\/octet-stream)?$/],
  ] as const) {
    const response = await request.get(release.baseUrl + path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()["content-type"] ?? "", path).toMatch(type);
    expect((await response.body()).byteLength, path).toBeGreaterThan(0);
  }
  const resources: string[] = [];
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== new URL(baseURL!).origin) {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname.startsWith("/emulatorjs/data/")) resources.push(url.pathname);
    return route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
  const save = page.getByRole("button", { name: "保存进度", exact: true });
  await expect(save).toBeEnabled({ timeout: 45_000 });
  const frame = page.frames().find((frame) => frame.url().endsWith("/player.html"))!;
  await waitForPicture(frame);
  expect(await frame.evaluate(() => ({ isolated: crossOriginIsolated, threads: (window as any).EJS_threads, path: (window as any).EJS_pathtodata })))
    .toEqual({ isolated: true, threads: true, path: "/emulatorjs/data/" });
  for (const path of ["emulator.min.js", "emulator.min.css", "localization/zh-CN.json", "cores/fceumm-thread-wasm.data"])
    expect(resources).toContain(`/emulatorjs/data/${path}`);
  await save.click();
  await expect(page.getByRole("status")).toHaveText("进度已保存");
  expect(external).toEqual([]);
  await page.screenshot({ path: resolve(root, "../temp/screenshot/bundled-nes-playing.png"), fullPage: true });
});
