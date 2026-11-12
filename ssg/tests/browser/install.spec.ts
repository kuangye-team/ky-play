import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { waitForPicture } from "./helpers";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

const games = JSON.parse(readFileSync(new URL("../../licenses/games/bundled.json", import.meta.url), "utf8"));

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");

test("新游戏库展示两款游戏，许可页使用指定的上游链接", async ({ page, request }) => {
  const downloads: string[] = [];
  page.on("request", (req) => {
    if (games.some((game: { romUrl: string }) => req.url().endsWith(game.romUrl))) downloads.push(req.url());
  });
  await page.goto("/");
  for (const game of games)
    await expect(page.getByRole("button", { name: `开始 ${game.name}`, exact: true })).toBeEnabled();
  await expect(page.locator(".slot-count")).toHaveText("2 / 3");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.screenshot({ path: `${shots}/bundled-start-${width}.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".main-panel").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  expect(downloads).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  const about = page.getByRole("dialog", { name: "关于拾光", exact: true });
  await expect(about.locator(".about-version")).toHaveCount(0);
  await expect(about.getByRole("button", { name: "检查更新", exact: true })).toHaveCount(0);
  await expect(about.getByRole("link", { name: "github.com/kuangye-team/ky-play", exact: true })).toHaveAttribute(
    "href", "https://github.com/kuangye-team/ky-play",
  );
  await page.screenshot({ path: `${shots}/about-source-link.png`, animations: "disabled" });
  await about.getByRole("button", { name: "开始玩吧", exact: true }).click();
  for (const game of games) {
    await page.goto("/library");
    await page.locator(".bundled-game-credit").filter({ hasText: game.author }).getByRole("link").click();
    await expect(page).toHaveURL(`/about#${game.id}`);
    const license = page.locator(`#${game.id}`);
    await expect(license).toBeInViewport();
    await expect(license).toContainText(game.author);
    await expect(license).toContainText(game.license);
    for (const [name, url] of [
      ["项目主页与源码", game.projectUrl],
      ["下载游戏文件", game.downloadUrl],
      ["下载对应源码", game.sourceUrl],
    ]) await expect(license.getByRole("link", { name, exact: true })).toHaveAttribute("href", url);
    const response = await request.get(game.romUrl);
    expect(response.ok()).toBe(true);
    expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(game.sha256);
    const licenseUrl = (await license.getByRole("link", { name: "许可全文" }).getAttribute("href"))!;
    expect(await page.evaluate(async (url) => (await fetch(url)).text(), licenseUrl)).toContain(game.sourceUrl);
  }
  await page.screenshot({ path: `${shots}/bundled-licenses.png`, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/bundled-licenses-mobile.png`, animations: "disabled" });
  expect(await page.locator(".main-panel").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

for (const game of games) test(`${game.name} 实际游玩、存档与本地缓存可用`, async ({ page }) => {
  test.setTimeout(90_000);
  const downloads: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith(game.romUrl)) downloads.push(req.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: `开始 ${game.name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({ timeout: 45_000 });
  const frame = page.frames().find((frame) => frame.url().endsWith("/player.html"))!;
  await waitForPicture(frame);
  const picture = await frame.evaluate(async () => Array.from(await (window as any).EJS_emulator.gameManager.screenshot()) as number[]);
  await mkdir(shots, { recursive: true });
  await writeFile(resolve(shots, `${game.id}-cover.png`), Buffer.from(picture));
  await page.screenshot({ path: `${shots}/${game.id}-playing.png`, fullPage: true });
  await page.getByRole("button", { name: "保存进度", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("进度已保存");
  expect(downloads).toHaveLength(1);
  await page.route(`**${game.romUrl}`, (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({ timeout: 45_000 });
  await expect(page.getByRole("status")).toHaveText("已恢复游戏进度");
  expect(downloads).toHaveLength(1);
});

test("移除附赠游戏后不自动恢复，手动添加的游戏刷新后仍可使用", async ({ page }) => {
  const gameRequests: string[] = [];
  page.on("request", (request) => {
    if (/\.(nes|nds|z64)(?:\?|$)/.test(request.url()))
      gameRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".slot-count")).toHaveText("2 / 3");
  await page.evaluate(async () => {
    const { deleteGame } = await import("/src/lib/storage.ts");
    await deleteGame("thwaite-nes");
    await deleteGame("nes-runner");
  });
  await page.reload();
  const add = page.getByRole("button", { name: "添加你的第一款游戏", exact: true });
  await expect(add).toBeEnabled();
  await expect(page.locator(".slot-count")).toHaveText("0 / 3");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.screenshot({ path: `${shots}/empty-start-${width}.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".main-panel").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/library");
  await expect(page.locator(".game-card")).toHaveCount(0);
  await page.screenshot({ path: `${shots}/empty-library.png` });
  await page.goto("/");
  await add.click();
  await page.getByLabel("选择游戏文件").setInputFiles(resolve(import.meta.dirname, "../../public/game/thwaite.nes"));
  await expect(page.locator(".upload-results .success")).toHaveCount(1);
  await page.getByRole("button", { name: "去游戏库看看" }).click();
  await page.reload();
  await expect(page.locator(".game-card")).toHaveCount(1);
  await page.getByRole("button", { name: "开始 thwaite", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存进度", exact: true })).toBeEnabled({ timeout: 45_000 });
  expect(gameRequests).toEqual([]);
});

test("附赠游戏名称跟随语言切换，用户修改的名称保持不变", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "切换语言", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /English/ }).click();
  await expect(page.getByRole("button", { name: "Play Thwaite", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Play nes-runner", exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const { database } = await import("/src/lib/storage.ts");
    const db = await database;
    const game = (await db.get("games", "thwaite-nes"))!;
    await db.put("games", { ...game, name: "我的小镇" });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Play 我的小镇", exact: true })).toBeEnabled();
});

test("浏览器识别安装清单，应用图标和启动地址有效", async ({ page, context, baseURL }) => {
  await page.goto("/library");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /^data:application\/manifest\+json,/);
  const manifest = await page.evaluate(async () =>
    (await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href)).json());
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe(`${baseURL}/`);
  expect(manifest.scope).toBe(`${baseURL}/`);
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  for (const icon of [...manifest.icons, { src: appleIcon, sizes: "180x180" }]) {
    expect(icon.src).toMatch(/^data:image\/png;base64,/);
    const dimensions = await page.evaluate(async (src) => {
      const image = await createImageBitmap(await (await fetch(src)).blob());
      const size = `${image.width}x${image.height}`;
      image.close();
      return size;
    }, icon.src);
    expect(dimensions).toBe(icon.sizes);
  }
  const cdp = await context.newCDPSession(page);
  const result = await cdp.send("Page.getAppManifest");
  expect(result.errors).toEqual([]);
  await expect.poll(async () => (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([]);
  await cdp.detach();
});
