import { importTestGames } from "./library-fixture";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { waitForPicture } from "./helpers";

test.beforeEach(async ({ page }) => {
  await importTestGames(page);
});

const shots = resolve(import.meta.dirname, "../../../temp/screenshot");
const pages = [
  ["library", "游戏库"],
  ["recent", "最近游玩"],
  ["favorites", "我的收藏"],
  ["saves", "我的存档"],
  ["storage", "存储管理"],
  ["tags", "标签管理"],
  ["controls", "外设设置"],
  ["about", "开源许可"],
  ["privacy", "隐私说明"],
] as const;

test("页面切换更新地址，刷新后保留页面和导航选中状态", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".quick-slots .quick-slot")).toHaveCount(3);
  for (const [path, title] of pages) {
    const link = page.locator(".sidebar").getByRole("link", {
      name: new RegExp(title),
    });
    await link.click();
    await expect(page).toHaveURL(`/${path}`);
    await page.reload();
    await expect(page.getByRole("heading", { name: new RegExp(title), level: 1 }))
      .toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveTitle(`${title} · 拾光`);
    await expect(page.locator(".welcome-banner")).toHaveCount(0);
  }
  await page.locator(".brand").click();
  await expect(page).toHaveURL("/");
  await page.reload();
  await expect(page.locator(".welcome-banner")).toBeVisible();
});

test("可直接打开各页面地址", async ({ page }) => {
  for (const [path, title] of pages) {
    const response = await page.goto(`/${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: new RegExp(title), level: 1 }))
      .toBeVisible();
  }
});

test("筛选、排序和视图在刷新及前进后退后恢复", async ({ page }) => {
  await page.goto("/library");
  const platforms = page.getByRole("group", { name: "游戏平台", exact: true });
  const tags = page.getByRole("group", { name: "游戏标签", exact: true });
  await platforms.getByRole("button", { name: "NES", exact: true }).click();
  await tags.getByRole("button", { name: "轻松一下", exact: true }).click();
  await page.getByRole("button", { name: "排序方式" }).click();
  await page.getByRole("menuitemradio", { name: /游戏名称/ }).click();
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page).toHaveURL("/library?system=nes&tag=relax&sort=name&view=list");
  await page.reload();
  await expect(platforms.getByRole("button", { name: "NES", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(tags.getByRole("button", { name: "轻松一下", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "排序方式" })).toContainText("游戏名称");
  await expect(page.locator(".games-grid")).toHaveClass(/list-view/);
  await expect(page.locator(".game-card")).toHaveCount(1);
  await expect(page.locator(".game-card")).toContainText("Thwaite 测试副本");
  await page.screenshot({ path: `${shots}/routing-library-refresh.png` });
  await page.locator(".sidebar").getByRole("link", { name: "外设设置" }).click();
  await page.locator(".sidebar").getByRole("link", { name: "存储管理" }).click();
  await page.goBack();
  await expect(page).toHaveURL("/controls");
  await expect(page.getByRole("heading", { name: "外设设置" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("/library?system=nes&tag=relax&sort=name&view=list");
  await expect(page.locator(".game-card")).toHaveCount(1);
  await expect(page.locator(".games-grid")).toHaveClass(/list-view/);
  await page.goForward();
  await expect(page).toHaveURL("/controls");
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL("/library?system=nes&tag=relax&sort=name");
  await expect(page.locator(".games-grid")).not.toHaveClass(/list-view/);
});

test("手机导航、说明页面之间的链接和刷新均可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "展开导航" }).click();
  await page.locator(".sidebar").getByRole("link", { name: "外设设置" }).click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "外设设置" })).toBeVisible();
  await page.screenshot({ path: `${shots}/routing-controls-mobile.png` });
  await page.getByRole("button", { name: "展开导航" }).click();
  await page.locator(".sidebar").getByRole("link", { name: "开源许可" }).click();
  await page.getByRole("link", { name: "阅读隐私说明" }).click();
  await expect(page).toHaveURL("/privacy");
  await page.reload();
  await expect(page.getByRole("heading", { name: "隐私说明" })).toBeVisible();
  await page.locator(".legal-endnote").getByRole("link", { name: "开源许可" }).click();
  await expect(page).toHaveURL("/about");
});

test("无效地址和参数有可用的回退页面", async ({ page }) => {
  await page.goto("/missing-page");
  await expect(page).toHaveURL("/");
  await expect(page.locator(".welcome-banner")).toBeVisible();
  await page.goto("/library?system=missing&sort=missing&view=missing");
  await expect(page.getByRole("button", { name: "所有平台" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".game-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "排序方式" })).toContainText("最近添加");
  await expect(page.locator(".games-grid")).not.toHaveClass(/list-view/);
  await page.goto("/play/missing-game");
  await expect(page).toHaveURL("/library");
  await expect(page.getByRole("status")).toContainText("这个游戏不在当前游戏库中");
});

test("游戏地址支持刷新、恢复存档及前进后退", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/library");
  await page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
  await expect(page).toHaveURL("/play/thwaite-test");
  await expect(page.getByRole("button", { name: "保存进度", exact: true }))
    .toBeEnabled({ timeout: 45_000 });
  await waitForPicture(page.frames().find((frame) => frame.url().endsWith("/player.html"))!);
  await page.getByRole("button", { name: "保存进度", exact: true }).click();
  await expect(page.getByText("进度已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL("/play/thwaite-test");
  await expect(page.getByText("已恢复游戏进度", { exact: true }))
    .toBeVisible({ timeout: 45_000 });
  await waitForPicture(page.frames().find((frame) => frame.url().endsWith("/player.html"))!);
  await page.screenshot({ path: `${shots}/routing-player-refresh.png` });
  await page.goBack();
  await expect(page).toHaveURL("/library");
  await expect(page.locator(".player")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL("/play/thwaite-test");
  await expect(page.getByRole("button", { name: "保存进度", exact: true }))
    .toBeEnabled({ timeout: 45_000 });
  await page.getByRole("button", { name: "返回游戏库", exact: true }).click();
  await expect(page).toHaveURL("/library");
  await page.reload();
  await expect(page.getByRole("heading", { name: /游戏库/, level: 1 })).toBeVisible();
});
