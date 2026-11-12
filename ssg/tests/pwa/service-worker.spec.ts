import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { waitForPicture } from "../browser/helpers";

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");
const workerPath = resolve(import.meta.dirname, "../../dist/sw.js");

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })).toBeEnabled();
}

test("首次缓存不下载许可文件、游戏和内核，离线页面、播放器与安装清单可打开", async ({ page, context }) => {
  const largeDownloads: string[] = [];
  const licenseDownloads: string[] = [];
  context.on("request", (request) => {
    if (/\/emulator\/|\.(nes|data|wasm|zip)(?:\?|$)/.test(request.url())) largeDownloads.push(request.url());
    if (new URL(request.url()).pathname.startsWith("/licenses/")) licenseDownloads.push(request.url());
  });
  await openApp(page);
  await expect(page.getByRole("region", { name: "网站更新" })).toHaveCount(0);
  expect(largeDownloads).toEqual([]);
  expect(licenseDownloads).toEqual([]);
  const urls = await page.evaluate(async () => (await Promise.all(
    (await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)),
  )).flat());
  expect(urls.some((url) => /\/emulator\/|\.(nes|data|wasm|zip)(?:\?|$)/.test(url))).toBe(false);
  expect(urls.some((url) => new URL(url).pathname.startsWith("/licenses/"))).toBe(false);
  const cdp = await context.newCDPSession(page);
  expect((await cdp.send("Page.getAppManifest")).errors).toEqual([]);
  expect((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors
    .filter((error: { errorId: string }) => error.errorId !== "in-incognito")).toEqual([]);
  await cdp.detach();

  await context.setOffline(true);
  await page.goto("/library?view=list");
  await expect(page.getByRole("heading", { name: /^游戏库/ })).toBeVisible();
  await page.screenshot({ path: `${shots}/sw-offline-library.png` });
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "隐私说明", exact: true })).toBeVisible();
  const assets = await page.evaluate(async () => {
    const player = await fetch("/player.html");
    const manifest = await (await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href)).json();
    const icon = await createImageBitmap(await (await fetch(manifest.icons[0].src)).blob());
    const iconSize = icon.width;
    icon.close();
    return { html: await player.text(), coep: player.headers.get("Cross-Origin-Embedder-Policy"),
      coop: player.headers.get("Cross-Origin-Opener-Policy"), iconSize, manifest };
  });
  expect(assets.html).toContain("shiguang-player");
  expect(assets.html).not.toMatch(/<script\s+src=/);
  expect(assets.coep).toBe("require-corp");
  expect(assets.coop).toBe("same-origin");
  expect(assets.iconSize).toBe(192);
  expect(assets.manifest.start_url).toBe(new URL("/", page.url()).href);
  const download = await context.newPage();
  await expect(download.goto("/game/thwaite.nes")).rejects.toThrow();
  await expect(download.goto("/emulator/missing.js")).rejects.toThrow();
  await download.close();
});

test("许可列表与全文按需合并缓存，离线查看和导出不再请求零散文件", async ({ page, context }) => {
  const requestedLicenses = new Set<string>();
  let indexUrl = "";
  context.on("request", (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/licenses/index.json") indexUrl = url.pathname + url.search;
    if (path.startsWith("/licenses/")) requestedLicenses.add(path);
  });
  await openApp(page);
  expect([...requestedLicenses]).toEqual([]);

  // A list cached by an older app must not replace this release's game credits.
  await page.evaluate(async () => {
    const cache = await caches.open("license-documents");
    await cache.put("/licenses/index.json", new Response(JSON.stringify({ entries: [{
      id: "removed-game", name: "已移除的游戏", version: "old", license: "old",
      group: "game", projectUrl: "#", licenseUrl: "/licenses/removed-game.txt",
    }] }), { headers: { "Content-Type": "application/json" } }));
  });

  await context.setOffline(true);
  await page.goto("/about");
  await expect(page.getByRole("alert")).toContainText("许可列表暂时没有加载成功");
  await expect(page.locator("#removed-game")).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  const licenseLinks = page.getByRole("link", { name: "许可全文", exact: true });
  await expect(licenseLinks.first()).toBeVisible();
  await expect(page.locator("#thwaite-nes")).toContainText("小镇反弹道导弹");
  await expect(page.locator("#nes-runner")).toContainText("无限奔跑");
  await expect(page.locator("#removed-game")).toHaveCount(0);
  expect([...requestedLicenses]).toEqual(["/licenses/index.json"]);
  const licenseUrl = (await licenseLinks.first().getAttribute("href"))!;
  const [document] = await Promise.all([
    context.waitForEvent("page"),
    licenseLinks.first().click(),
  ]);
  await document.waitForLoadState("domcontentloaded");
  const licenseText = await document.locator("body").innerText();
  expect(licenseText).toContain("Thwaite");
  expect(licenseUrl).toMatch(/^blob:/);
  expect([...requestedLicenses]).toEqual(["/licenses/index.json"]);
  const sourceText = await readFile(resolve(import.meta.dirname, "../../dist/licenses/index.json"), "utf8");
  expect(licenseText).toBe(JSON.parse(sourceText).entries[0].text);
  const isLicenseCached = () => page.evaluate(async ({ url, text }) => {
    const response = await caches.match(url);
    return (await response?.text()) === text;
  }, { url: indexUrl, text: sourceText });
  await expect.poll(isLicenseCached).toBe(true);
  await expect.poll(() => page.evaluate(async (url) => Boolean(await caches.match(url)), indexUrl)).toBe(true);

  // A saved copy must not hide newer content while the browser is online.
  await document.close();
  await page.evaluate(async (url) => {
    const cache = await caches.open("license-documents");
    await cache.put(url, new Response(JSON.stringify({ entries: [] }), {
      headers: { "Content-Type": "application/json" },
    }));
  }, indexUrl);
  await page.reload();
  await expect(licenseLinks.first()).toBeVisible();
  await expect.poll(isLicenseCached).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(licenseLinks.first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("#thwaite-nes")).toContainText("小镇反弹道导弹");
  await expect(page.locator("#nes-runner")).toContainText("无限奔跑");
  await page.screenshot({ path: `${shots}/sw-licenses-offline.png` });
  const [offlineDocument] = await Promise.all([
    context.waitForEvent("page"), licenseLinks.nth(1).click(),
  ]);
  await expect(offlineDocument.locator("body")).toContainText("nes-runner");
  const [download] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("link", { name: "下载全部许可说明" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("THIRD-PARTY-NOTICES.txt");
  const notices = await readFile((await download.path())!, "utf8");
  for (const entry of JSON.parse(sourceText).entries) expect(notices).toContain(entry.text);
  expect([...requestedLicenses]).toEqual(["/licenses/index.json"]);
  await offlineDocument.close();
});

test("新版本可稍后更新，确认后才刷新，其他窗口的游戏和存档不受影响", async ({ page, context }) => {
  test.setTimeout(120_000);
  const original = await readFile(workerPath, "utf8");
  try {
    await openApp(page);
    const playing = await context.newPage();
    await openApp(playing);
    await playing.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
    const save = playing.getByRole("button", { name: "保存进度", exact: true });
    await expect(save).toBeEnabled({ timeout: 45_000 });
    const frame = playing.frames().find((frame) => frame.url().endsWith("/player.html"))!;
    await waitForPicture(frame);
    expect(await frame.evaluate(() => crossOriginIsolated)).toBe(true);
    await save.click();
    await expect(playing.locator(".toast")).toContainText("进度已保存");
    await playing.evaluate(() => { (window as any).__pwaPageIdentity = "game-kept-open"; });

    await writeFile(workerPath, `${original}\n// update-test-${Date.now()}\n`);
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
    const banner = page.getByRole("region", { name: "网站更新" });
    await expect(banner).toBeVisible();
    await expect(playing.locator(".update-banner")).toHaveCount(0);
    await page.screenshot({ path: `${shots}/sw-update-desktop.png` });
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await banner.evaluate((element) => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `${shots}/sw-update-mobile.png` });
    await page.evaluate(() => { (window as any).__pwaPageIdentity = "update-deferred"; });
    await banner.getByRole("button", { name: "稍后", exact: true }).click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__pwaPageIdentity)).toBe("update-deferred");
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await expect(banner).toBeVisible();
    await page.getByRole("button", { name: "从设备添加游戏", exact: true }).click();
    await expect(page.locator(".update-banner button").last()).toBeDisabled();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(banner.getByRole("button", { name: "更新并刷新" })).toBeEnabled();
    await Promise.all([
      page.waitForEvent("load"),
      banner.getByRole("button", { name: "更新并刷新" }).click(),
    ]);
    await expect(page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })).toBeEnabled();
    await expect(banner).toHaveCount(0);
    expect(await playing.evaluate(() => (window as any).__pwaPageIdentity)).toBe("game-kept-open");
    await expect(playing.locator(".update-banner")).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(playing.locator(".toast")).toContainText("进度已保存");
    await waitForPicture(frame);
    await playing.screenshot({ path: `${shots}/sw-game-preserved.png` });
    await playing.getByRole("button", { name: "返回游戏库", exact: true }).click();
    const gameBanner = playing.getByRole("region", { name: "网站更新" });
    await expect(gameBanner).toBeVisible();
    await Promise.all([
      playing.waitForEvent("load"),
      gameBanner.getByRole("button", { name: "更新并刷新" }).click(),
    ]);
    await expect(playing.getByRole("heading", { name: /^游戏库/ })).toBeVisible();
    await playing.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
    await expect(save).toBeEnabled({ timeout: 45_000 });
    await expect(playing.locator(".toast")).toContainText("已恢复游戏进度");
  } finally {
    await writeFile(workerPath, original);
  }
});
