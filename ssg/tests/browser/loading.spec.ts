import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const entry = /\/(?:src\/main\.tsx|assets\/index-[^/]+\.js)(?:\?|$)/;
const shots = resolve(import.meta.dirname, "../../../temp/screenshot");

test("脚本下载前显示 loading，准备好后解除遮罩与交互限制", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(entry, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  try {
    await expect(page.locator("#boot-loading")).toBeVisible();
    await expect(page.locator("#boot-brand")).toHaveText("拾光");
    await expect(page.locator("#boot-message")).toHaveText("正在打开拾光…");
    await expect(page.locator(".boot-orbit")).toHaveCSS("animation-name", "boot-spin");
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    await expect(page.locator("#root")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#boot-reload")).toBeHidden();
    await page.screenshot({ path: `${shots}/loading-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${shots}/loading-mobile.png` });
    await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".boot-orbit")).toHaveCSS("animation-name", "none");
  } finally {
    release();
  }
  await expect(page.locator("#boot-loading")).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#root")).not.toHaveAttribute("aria-busy", "true");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "从设备添加游戏", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("首屏沿用四个主题和已选语言", async ({ page }) => {
  await page.route(entry, (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  for (const [theme, color] of [
    ["matcha", "rgb(86, 124, 67)"],
    ["ocean", "rgb(38, 126, 170)"],
    ["violet", "rgb(121, 86, 222)"],
    ["midnight", "rgb(177, 160, 255)"],
  ]) {
    await page.goto("/");
    await page.evaluate((theme) => {
      localStorage.setItem("shiguang.preferences", JSON.stringify({ theme, language: "en" }));
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("#boot-brand")).toHaveText("Oasis");
    await expect(page.locator("#boot-message")).toHaveText("Opening Oasis…");
    await expect(page.locator(".boot-symbol svg")).toHaveCSS("color", color);
    await page.screenshot({ path: `${shots}/loading-${theme}-en.png` });
  }
});

test("脚本下载失败可重试，成功后进入页面", async ({ page }) => {
  await page.route(entry, (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#boot-message")).toHaveText("页面暂时没有打开，请检查网络后重试。");
  await expect(page.locator(".boot-orbit")).toBeHidden();
  await page.screenshot({ path: `${shots}/loading-retry.png` });
  await page.unroute(entry);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.locator("#boot-loading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "从设备添加游戏", exact: true }).first()).toBeEnabled();
});

test("游戏库打开失败时停止动画并提供恢复入口", async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new Error("Storage unavailable"); };
  });
  await page.goto("/");
  await expect(page.locator("#boot-message")).toContainText("请确认浏览器允许保存网站数据");
  await expect(page.locator(".boot-orbit")).toBeHidden();
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
});

test("无法读取偏好时跟随系统语言，仍可进入页面", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("Blocked", "SecurityError"); },
    });
    Object.defineProperty(navigator, "languages", { value: ["en-US"] });
  });
  await page.goto("/");
  await expect(page.locator("#boot-loading")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "matcha");
  await expect(page.getByRole("button", { name: "Add games", exact: true }).first()).toBeEnabled();
});

test("生产样式下载期间保持 loading，下载完成后再交接", async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(":4173"), "仅生产构建包含独立样式文件");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/assets\/.*\.css$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  try {
    await expect(page.locator("#boot-loading")).toBeVisible();
    // React has mounted and read the library, but the stylesheet is still held.
    await expect(page.locator(".banner-cta")).toBeEnabled();
    await expect(page.locator("#boot-loading")).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    await page.screenshot({ path: `${shots}/loading-before-styles.png` });
  } finally {
    release();
  }
  await expect(page.locator("#boot-loading")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toHaveCSS("display", "grid");
});

test("生产样式下载失败显示重试入口", async ({ page, baseURL }) => {
  test.skip(!baseURL?.includes(":4173"), "仅生产构建包含独立样式文件");
  await page.route(/\/assets\/.*\.css$/, (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#boot-message")).toHaveText("页面暂时没有打开，请检查网络后重试。");
  await expect(page.locator(".boot-orbit")).toBeHidden();
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
});
