import { mockDesktopStorage } from "./storage-fixture";
import { expect, test } from "@playwright/test";
import { importTestGames } from "../browser/library-fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      nativeCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => { calls.push(command); },
      },
    });
  });
  await mockDesktopStorage(page);
});

test("F12 opens native devtools from the library and dialogs without repeating", async ({ page }) => {
  await page.goto("/");
  const calls = () => page.evaluate(() =>
    (window as any).nativeCalls.filter((command: string) => command === "open_devtools"));
  await expect(page.getByRole("button", { name: "关于拾光", exact: true })).toBeVisible();
  await page.keyboard.down("F12");
  await expect.poll(calls).toHaveLength(1);
  await page.keyboard.down("F12");
  await page.keyboard.up("F12");
  await page.getByRole("button", { name: "关于拾光", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("F12");
  await expect.poll(calls).toHaveLength(2);
});

test("F12 in the focused game frame opens native devtools even while loading", async ({ page }) => {
  // Keep the real player keyboard bridge, without downloading an emulator core.
  await page.route("**/loader.js", (route) => route.fulfill({
    contentType: "application/javascript", body: "",
  }));
  await importTestGames(page);
  await page.reload();
  await page.getByRole("button", { name: "开始 小镇反弹道导弹", exact: true }).click();
  const game = page.frameLocator('iframe[src="/player.html"]');
  await game.locator("body").press("F12");
  await expect.poll(() => page.evaluate(() =>
    (window as any).nativeCalls.filter((command: string) => command === "open_devtools")),
  ).toHaveLength(1);
});
