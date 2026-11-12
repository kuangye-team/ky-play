import { expect, test } from "@playwright/test";
import { mockDesktopStorage } from "./storage-fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      openedUrls: [],
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { url?: string }) => {
          if (command !== "plugin:opener|open_url") return;
          if ((window as any).failOpen) throw new Error("Unavailable");
          (window as any).openedUrls.push(args.url);
        },
      },
    });
  });
  await mockDesktopStorage(page);
});

test("desktop opens the public web app in the system browser", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "打开WEB端", exact: true });
  await expect(trigger).toBeVisible();
  await expect(trigger.locator("xpath=following-sibling::*[1]")).toHaveClass(/about-trigger/);
  await expect(page.getByRole("button", { name: "打开客户端", exact: true })).toHaveCount(0);
  await trigger.click();
  await expect.poll(() => page.evaluate(() => (window as any).openedUrls)).toEqual(["https://play.kuangye.team/"]);
  await expect(page).toHaveURL(/localhost:1421/);
  await page.screenshot({ path: "../temp/screenshot/client-access-desktop.png", fullPage: true });
});

test("desktop reports an opening failure and allows retry", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).failOpen = true; });
  const trigger = page.getByRole("button", { name: "打开WEB端", exact: true });
  await trigger.click();
  await expect(page.getByRole("status")).toContainText("链接暂时无法打开，请稍后重试。");
  await page.evaluate(() => { (window as any).failOpen = false; });
  await trigger.click();
  await expect.poll(() => page.evaluate(() => (window as any).openedUrls)).toHaveLength(1);
});
