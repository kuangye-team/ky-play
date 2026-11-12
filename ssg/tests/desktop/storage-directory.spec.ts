import { expect, test } from "@playwright/test";
import { mockDesktopStorage } from "./storage-fixture";

const destination = "/Volumes/Games/拾光游戏库";

test.beforeEach(async ({ page }) => {
  await mockDesktopStorage(page);
});

test("directory changes can be cancelled, retried and retained after reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "存储管理", exact: true }).click();
  const section = page.getByRole("region", { name: "数据存储目录" });
  await expect(section).toContainText("/Users/player/Library/Application Support/com.kuangye.ky-play");
  await section.getByRole("button", { name: "修改目录" }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).lastDirectoryOptions)).toBe(true);
  await expect(section.getByRole("button", { name: "修改目录" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate((directory) => { (window as any).selectedStorageDirectory = directory; }, destination);
  await section.getByRole("button", { name: "修改目录" }).click();
  const dialog = page.getByRole("dialog", { name: "迁移数据存储目录" });
  await expect(dialog).toContainText(destination);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).storageMoveCalls || 0)).toBe(0);
  expect(await page.evaluate(() => (window as any).lastDirectoryOptions)).toMatchObject({ directory: true, multiple: false });

  await page.evaluate(() => { (window as any).failStorageMove = "storage_directory_not_empty"; });
  await section.getByRole("button", { name: "修改目录" }).click();
  await dialog.getByRole("button", { name: "开始迁移" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("请选择空文件夹，避免覆盖已有数据。");
  await expect(page.locator(".storage-directory-path").first()).toContainText("/Users/player/Library/Application Support/com.kuangye.ky-play");
  await page.evaluate(() => {
    (window as any).failStorageMove = false;
    (window as any).storageMoveDelay = 800;
  });
  await dialog.getByRole("button", { name: "开始迁移" }).click();
  await expect(dialog.getByRole("button", { name: "正在迁移…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(section).toContainText(destination);
  await page.reload();
  await expect(section).toContainText(destination);
  await page.screenshot({ path: "../temp/screenshot/storage-directory.png", fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  const about = page.getByRole("dialog", { name: "关于拾光" });
  const links = about.locator(".about-contact a[href^='https://']");
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    const href = (await link.getAttribute("href"))!;
    await expect(link).toHaveText(href.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  }
  await expect(about.locator(".about-current-version strong")).toHaveText("v1.0.0");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (value: string) => { (window as any).copiedAddress = value; } },
  }));
  await about.getByRole("button", { name: "复制源码网址", exact: true }).click();
  expect(await page.evaluate(() => (window as any).copiedAddress)).toBe("https://github.com/kuangye-team/ky-play");
  await about.getByRole("button", { name: "复制主页网址", exact: true }).click();
  expect(await page.evaluate(() => (window as any).copiedAddress)).toBe("https://www.kuangye.team/");
  await page.screenshot({ path: "../temp/screenshot/about-addresses.png", fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
});

test("directory lookup failures can retry and migration cleanup warnings remain visible", async ({ page }) => {
  await page.addInitScript(() => { (window as any).failStorageInfo = true; });
  await page.goto("/");
  await page.getByRole("link", { name: "存储管理", exact: true }).click();
  const section = page.getByRole("region", { name: "数据存储目录" });
  await expect(section.getByRole("alert")).toContainText("暂时无法读取存储目录");
  await page.evaluate(() => {
    (window as any).failStorageInfo = false;
    (window as any).selectedStorageDirectory = "/Volumes/Games/Oasis";
    (window as any).storageCleanupWarning = true;
  });
  await section.getByRole("button", { name: "重新读取" }).click();
  await expect(section.getByRole("alert")).toHaveCount(0);
  await section.getByRole("button", { name: "修改目录" }).click();
  await page.getByRole("button", { name: "开始迁移", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("原目录中的旧数据未能清理");
  await expect(section).toContainText("/Volumes/Games/Oasis");
});

test("storage directory fits narrow windows and English themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    const { setPreferences } = await import("/src/lib/preferences.ts");
    setPreferences({ language: "en", theme: "midnight" });
  });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "Storage", exact: true }).click();
  const section = page.getByRole("region", { name: "Data storage folder" });
  await expect(section.getByRole("button", { name: "Change folder" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../temp/screenshot/storage-directory-mobile-dark.png", fullPage: true, animations: "disabled" });
});
