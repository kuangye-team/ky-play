import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { waitForPicture } from "../browser/helpers";

const root = resolve(import.meta.dirname, "../..");
const shots = resolve(root, "../temp/screenshot");
let release: { baseUrl: string; runtimeVersion: string };

test.beforeAll(async () => {
  release = JSON.parse(await readFile(resolve(root, "dist/emulator-release.json"), "utf8"));
});

async function openThwaite(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })).toBeEnabled();
}

test("CDN 构建剥离模拟器资源，首页显示新文案", async ({ page, request }) => {
  expect(existsSync(resolve(root, "dist/emulator"))).toBe(false);
  expect(existsSync(resolve(root, "dist/emulatorjs"))).toBe(false);
  expect((await readdir(resolve(root, "dist/game"))).sort()).toEqual([
    "runner.nes", "thwaite.nes",
  ]);
  const assets = await readdir(resolve(root, "dist/assets"));
  expect(assets.filter((name) => name.endsWith(".js"))).toHaveLength(1);
  expect(assets.filter((name) => name.endsWith(".css"))).toHaveLength(1);
  expect(assets).toHaveLength(2);
  expect(await readdir(resolve(root, "dist/licenses"))).toEqual(["index.json"]);
  expect(release.baseUrl).toBe(`http://127.0.0.1:4174/lib/emulatorjs/4.2.3/data/`);
  expect(release.runtimeVersion).toBe("4.2.3");
  expect(await readFile(resolve(root, "dist/_headers"), "utf8")).toContain("Cross-Origin-Embedder-Policy: require-corp");
  await page.goto("/");
  await expect(page.getByText("桂花载酒，与少年游。")).toBeVisible();
  await page.screenshot({ path: `${shots}/r2-home-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/r2-home-mobile.png`, fullPage: true });
  const remote = await request.get(`${release.baseUrl}cores/ppsspp-assets.zip`);
  expect(remote.ok()).toBe(true);
  expect(remote.headers()["access-control-allow-origin"]).toBe("*");
});

test("独立域名加载真实 NES 内核，保持多线程、画面和存档", async ({ page }) => {
  const remote: string[] = [];
  const failures: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://127.0.0.1:4174")) {
      const url = new URL(request.url());
      remote.push(url.origin + url.pathname);
    }
  });
  page.on("requestfailed", (request) => failures.push(request.url()));
  await openThwaite(page);
  await page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
  const save = page.getByRole("button", { name: "保存进度", exact: true });
  await expect(save).toBeEnabled({ timeout: 45_000 });
  const frame = page.frames().find((frame) => frame.url().endsWith("/player.html"))!;
  await waitForPicture(frame);
  expect(await frame.evaluate(() => ({ isolated: crossOriginIsolated, threads: (window as any).EJS_threads, path: (window as any).EJS_pathtodata })))
    .toEqual({ isolated: true, threads: true, path: release.baseUrl });
  expect(await frame.evaluate(() => (window as any).EJS_emulator.ejs_version)).toBe("4.2.3");
  for (const path of ["emulator.min.js", "emulator.min.css", "localization/zh-CN.json", "cores/fceumm-thread-wasm.data"])
    expect(remote).toContain(release.baseUrl + path);
  expect(remote.every((url) => url.startsWith(release.baseUrl))).toBe(true);
  expect(failures).toEqual([]);
  await save.click();
  await expect(page.getByRole("status")).toHaveText("进度已保存");
  await page.screenshot({ path: `${shots}/r2-nes-playing.png`, fullPage: true });
});

test("远端入口不可用时显示可理解的失败提示", async ({ page }) => {
  await page.route(`${release.baseUrl}emulator.min.js`, (route) => route.abort());
  await openThwaite(page);
  await page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
  await expect(page.locator(".game-overlay")).toContainText("游戏没有加载成功，请重新打开。");
});
